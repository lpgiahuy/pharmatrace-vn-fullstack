import { calculateEstimatedDelivery } from '../order/helpers/shipping-calculator.helper';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LogisticsService } from './shipment/logistics.service';
import { InternalTransferService } from './internal-transfer/internal-transfer.service';
import { OrderService } from '../order/order.service';
import { AdminOrderService } from '../order/admin-order.service';

describe('Logistics & Order Management Verification Test Matrix', () => {
  // Test actor fixtures (isolated in-memory fixtures)
  const store1Staff = { id: 10, type: 'employee' as const, role: 'WAREHOUSE_STAFF', facilityId: 1 };
  const store2Staff = { id: 20, type: 'employee' as const, role: 'WAREHOUSE_STAFF', facilityId: 2 };
  const superAdmin = { id: 99, type: 'employee' as const, role: 'SUPER_ADMIN', facilityId: 1 };
  const customerUser = { id: 77, type: 'customer' as const, role: 'CUSTOMER' };

  describe('TRF-01: Multi-Facility Access Control and Visibility for Internal Transfers', () => {
    it('restricts transfer visibility and operations strictly to source and destination facility staff', async () => {
      const tx = {
        internal_transfers: {
          findMany: jest.fn().mockImplementation(({ where }) => {
            if (where?.OR) {
              const matchedFacility = where.OR.some(
                (cond: { from_facility_id?: number; to_facility_id?: number }) =>
                  cond.from_facility_id === 1 || cond.to_facility_id === 1
              );
              return Promise.resolve(matchedFacility ? [{ id: 101, from_facility_id: 1, to_facility_id: 2 }] : []);
            }
            return Promise.resolve([{ id: 101, from_facility_id: 1, to_facility_id: 2 }]);
          }),
          findFirst: jest.fn().mockImplementation(({ where }) => {
            if (where.from_facility_id === 1 || where.to_facility_id === 1) {
              return Promise.resolve({ id: 101, from_facility_id: 1, to_facility_id: 2, status: 'REQUESTED' });
            }
            return Promise.resolve(null);
          }),
        },
        $queryRaw: jest.fn(),
      };

      const prisma = {
        withOrder: jest.fn((_op, cb) => cb(tx)),
        internal_transfers: tx.internal_transfers,
      };

      const transferService = new InternalTransferService(prisma as never);

      // Facility 1 staff (originating facility) can view transfer
      const store1List = await transferService.adminGetInternalTransfers(undefined, store1Staff);
      expect(store1List).toHaveLength(1);

      // Unrelated facility 3 staff cannot view or access transfer
      const unrelatedStaff = { id: 30, type: 'employee' as const, role: 'WAREHOUSE_STAFF', facilityId: 3 };
      const unrelatedList = await transferService.adminGetInternalTransfers(undefined, unrelatedStaff);
      expect(unrelatedList).toHaveLength(0);

      // SuperAdmin has global visibility across all facilities
      const adminList = await transferService.adminGetInternalTransfers(undefined, superAdmin);
      expect(adminList).toHaveLength(1);
    });
  });

  describe('TRF-02: Sequence Validation, Idempotent Cancellation, and Dispatch Prerequisites', () => {

    it('prohibits receiving an internal transfer before it has been dispatched (DISPATCHED status)', async () => {
      const tx = {
        internal_transfers: {
          findFirst: jest.fn().mockResolvedValue({
            id: 204,
            status: 'REQUESTED', // not yet DISPATCHED
            from_facility_id: 1,
            to_facility_id: 2,
            orders: { order_status: 'WAITING_INTERNAL_TRANSFER' },
          }),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };
      const prisma = {
        withOrder: jest.fn((_op, cb) => cb(tx)),
        internal_transfers: tx.internal_transfers,
      };
      const transferService = new InternalTransferService(prisma as never);

      await expect(transferService.adminReceiveInternalTransfer(204, store2Staff)).rejects.toThrow(
        /must be dispatched before it can be received/i
      );
    });
  });

  describe('SHIP-01: Carrier Details Validation, Gated Transitions, and Customer Receipt Enforcement', () => {
    it('blocks transition to PICKED_UP when carrier tracking number is not yet confirmed', async () => {
      const tx = {
        shipments: {
          findFirst: jest.fn().mockResolvedValue({
            id: 301,
            shipping_status: 'PENDING_PICKUP',
            carrier_confirmed_at: null, // carrier details unconfirmed
          }),
          updateMany: jest.fn(),
        },
        $queryRaw: jest.fn(),
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const logisticsService = new LogisticsService(prisma as never);

      await expect(
        logisticsService.changeStatus(301, { status: 'PICKED_UP' }, store1Staff)
      ).rejects.toThrow(/actual carrier tracking number before pickup/i);

      expect(tx.shipments.updateMany).not.toHaveBeenCalled();
    });

  });

  describe('SHIP-02: Sequential Shipment Lifecycle and Inventory Preservation', () => {
    it('progresses shipment statuses sequentially without redundant inventory deductions during shipping', async () => {
      let currentStatus = 'PENDING_PICKUP';
      let currentOrderStatus = 'PENDING_PICKUP';
      const tx = {
        shipments: {
          findFirst: jest.fn().mockImplementation(() =>
            Promise.resolve({
              id: 401,
              order_id: 501,
              orders: { order_status: currentOrderStatus },
              shipping_status: currentStatus,
              carrier_confirmed_at: new Date(),
            })
          ),
          updateMany: jest.fn().mockImplementation(({ data }) => {
            if (data?.shipping_status) currentStatus = data.shipping_status;
            return Promise.resolve({ count: 1 });
          }),
        },
        orders: { updateMany: jest.fn().mockImplementation(({ data }) => {
          currentOrderStatus = data.order_status;
          return Promise.resolve({ count: 1 });
        }) },
        $queryRaw: jest.fn().mockResolvedValue([]),
        $executeRaw: jest.fn(),
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const logisticsService = new LogisticsService(prisma as never);

      // Step 1: Picked up by courier
      await logisticsService.changeStatus(401, { status: 'PICKED_UP' }, store1Staff);
      expect(currentStatus).toBe('PICKED_UP');
      expect(currentOrderStatus).toBe('PICKED_UP');

      // Step 2: In transit to recipient
      await logisticsService.changeStatus(401, { status: 'IN_TRANSIT' }, store1Staff);
      expect(currentStatus).toBe('IN_TRANSIT');
      expect(currentOrderStatus).toBe('SHIPPING');

      // Step 3: Customer receives delivery
      const orderTx = { $queryRaw: jest.fn().mockResolvedValue([{ result: 'RECEIVED' }]) };
      const orderPrisma = { withOrder: jest.fn((_op, cb) => cb(orderTx)) };
      const orderService = new OrderService(orderPrisma as never);
      jest.spyOn(orderService, 'getMyOrderById').mockResolvedValueOnce({ id: 501, orderStatus: 'COMPLETED' } as never);

      const completedOrder = await orderService.confirmReceipt(customerUser.id, 501);
      expect(completedOrder).toMatchObject({ id: 501, orderStatus: 'COMPLETED' });

      // Verifies that shipping transitions never deduct inventory again (already deducted during packing)
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('SHIP-03: Concurrent Multi-Tab Operations and Idempotency Enforcement', () => {
    it('returns idempotent ALREADY_RECEIVED without duplicate events or stock modifications on simultaneous tabs', async () => {
      const orderTx = {
        $queryRaw: jest.fn().mockResolvedValueOnce([{ result: 'ALREADY_RECEIVED' }]),
      };
      const orderPrisma = { withOrder: jest.fn((_op, cb) => cb(orderTx)) };
      const orderService = new OrderService(orderPrisma as never);
      jest.spyOn(orderService, 'getMyOrderById').mockResolvedValueOnce({ id: 502, orderStatus: 'COMPLETED' } as never);

      // Confirm call from duplicate tab returns existing completed order cleanly
      const result = await orderService.confirmReceipt(customerUser.id, 502);
      expect(result).toMatchObject({ id: 502, orderStatus: 'COMPLETED' });
      expect(orderTx.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('ORD-01: Order Data Synchronization Across Customer and Admin Views', () => {
    it('strictly matches products, packaging variants, quantities, unit prices, shipping fee, discounts, and total amount between customer portal and admin portal', async () => {
      const sampleOrderRecord = {
        id: 801,
        order_code: 'ORD-261107-279A244F',
        customer_id: customerUser.id,
        order_status: 'PENDING',
        payment_method: 'COD',
        payment_status: 'UNPAID',
        export_facility_id: 1,
        subtotal_amount: 16600,
        shipping_fee: 35000,
        discount_amount: 0,
        used_points: 0,
        total_amount: 51600,
        recipient_name: 'Test User 2',
        recipient_phone: '0395838818',
        shipping_address: '38/14 Ao Doi, Binh Tri Dong, Ho Chi Minh City',
        created_at: new Date('2026-11-07T14:05:00Z'),
        order_items: [
          {
            id: 81,
            order_id: 801,
            medicine_id: 50,
            variant_id: 12,
            medicine_name: 'Andol S Tablets for Common Cold and Flu Symptoms',
            unit_name: 'Blister Pack',
            quantity: 1,
            unit_price: 16600,
            total_price: 16600,
            assigned_uids: [],
            inventory_reserved: true,
            source_facility_id: 1,
            medicines: {
              id: 50,
              medicine_name: 'Andol S Tablets for Common Cold and Flu Symptoms',
              image_url: '/images/andol-s.jpg',
              slug: 'andol-s-tablets',
              is_prescription: false,
            },
            source_facility: { id: 1, facility_name: 'Enervon Pharmacy Store #1' },
          },
        ],
        shipments: null,
        facilities: { id: 1, facility_name: 'Enervon Pharmacy Store #1' },
        internal_transfers: [],
        prescription_review: null,
        customers: {
          id: customerUser.id,
          full_name: 'Test User 2',
          email: 'customer2@pharmatrace.vn',
          phone_number: '0395838818',
        },
      };

      const customerTx = {
        orders: { findUnique: jest.fn().mockResolvedValue(sampleOrderRecord) },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };
      const customerPrisma = { withOrder: jest.fn((_op, cb) => cb(customerTx)) };
      const orderService = new OrderService(customerPrisma as never);

      const adminTx = {
        orders: { findFirst: jest.fn().mockResolvedValue(sampleOrderRecord) },
        $queryRaw: jest.fn(),
      };
      const adminPrisma = { withOrder: jest.fn((_op, cb) => cb(adminTx)) };
      const adminOrderService = new AdminOrderService(adminPrisma as never);

      // Customer accesses order at /account/orders
      const customerView = await orderService.getMyOrderById(customerUser.id, 801);

      // Admin/Pharmacist accesses same order code at /admin/orders
      const adminView = await adminOrderService.adminGetOrderById(801, store1Staff);

      // 1. Order codes and status match identically
      expect(customerView.orderCode).toBe('ORD-261107-279A244F');
      expect(customerView.orderCode).toBe(adminView.orderCode);
      expect(customerView.orderStatus).toBe(adminView.orderStatus);

      // 2. Financial totals strictly match between both views
      expect(customerView.subtotalAmount).toBe(16600);
      expect(customerView.subtotalAmount).toBe(adminView.subtotalAmount);
      expect(customerView.shippingFee).toBe(35000);
      expect(customerView.shippingFee).toBe(adminView.shippingFee);
      expect(customerView.discountAmount).toBe(0);
      expect(customerView.discountAmount).toBe(adminView.discountAmount);
      expect(customerView.totalAmount).toBe(51600);
      expect(customerView.totalAmount).toBe(adminView.totalAmount);

      // 3. Line items, quantities, packaging variants, and unit prices match identically
      expect(customerView.items).toHaveLength(1);
      expect(adminView.items).toHaveLength(1);
      expect(customerView.items[0].medicineName).toBe(adminView.items[0].medicineName);
      expect(customerView.items[0].unitName).toBe('Blister Pack');
      expect(customerView.items[0].unitName).toBe(adminView.items[0].unitName);
      expect(customerView.items[0].quantity).toBe(1);
      expect(customerView.items[0].quantity).toBe(adminView.items[0].quantity);
      expect(customerView.items[0].unitPrice).toBe(16600);
      expect(customerView.items[0].unitPrice).toBe(adminView.items[0].unitPrice);
      expect(customerView.items[0].totalPrice).toBe(adminView.items[0].totalPrice);
    });
  });

  describe('ORD-02: State-Dependent Order Cancellation Rules & Immutability', () => {
    it.each(['PENDING', 'WAITING_INTERNAL_TRANSFER'])('cancels %s orders, releasing reservations and restoring points', async (orderStatus) => {
      const orderRecord = {
        id: 802,
        order_code: 'ORD-802',
        customer_id: customerUser.id,
        order_status: orderStatus,
        export_facility_id: 1,
        used_points: 300,
      };

      const tx = {
        shipments: { findFirst: jest.fn().mockResolvedValue(null) },
        orders: {
          findUnique: jest.fn()
            .mockResolvedValueOnce(orderRecord)
            .mockResolvedValueOnce({ ...orderRecord, order_status: 'CANCELLED', order_items: [] }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        order_items: {
          findMany: jest.fn().mockResolvedValue([
            { id: 11, variant_id: 101, quantity: 2, assigned_uids: [], source_facility_id: 1 },
          ]),
          update: jest.fn(),
        },
        internal_transfers: { findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn() },
        customers: { update: jest.fn().mockResolvedValue({}) },
        loyalty_point_logs: { create: jest.fn().mockResolvedValue({}) },
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest.fn().mockResolvedValue([]),
      };

      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const orderService = new OrderService(prisma as never);

      const cancelledOrder = await orderService.cancelMyOrder(customerUser.id, 802, { reasonCode: 'CHANGED_MIND' });
      expect(cancelledOrder.orderStatus).toBe('CANCELLED');

      // Verifies inventory reservation release
      expect(tx.$executeRaw).toHaveBeenCalled();
      // Verifies loyalty point refund
      expect(tx.customers.update).toHaveBeenCalledWith({
        where: { id: customerUser.id },
        data: { reward_points: { increment: 300 } },
      });
      expect(tx.loyalty_point_logs.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          customer_id: customerUser.id,
          order_id: 802,
          transaction_type: 'REDEEM_REVERSAL',
          points: 300,
        }),
      });
    });

    it('blocks cancellation when order is in unpermitted statuses (SHIPPING or COMPLETED) and retains state immutability', async () => {
      // 1. Customer attempts to cancel SHIPPING order
      const shippingOrder = {
        id: 803,
        order_code: 'ORD-803',
        customer_id: customerUser.id,
        order_status: 'SHIPPING',
        export_facility_id: 1,
      };

      const tx = {
        shipments: { findFirst: jest.fn().mockResolvedValue(null) },
        orders: {
          findUnique: jest.fn().mockResolvedValue(shippingOrder),
          findFirst: jest.fn().mockResolvedValue(shippingOrder),
        },
        $queryRaw: jest.fn(),
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const orderService = new OrderService(prisma as never);
      const adminOrderService = new AdminOrderService(prisma as never);

      await expect(
        orderService.cancelMyOrder(customerUser.id, 803, { reasonCode: 'CHANGED_MIND' })
      ).rejects.toThrow(/Only unpacked orders can be cancelled/i);

      // 2. Admin attempts to cancel order currently in SHIPPING status
      await expect(
        adminOrderService.adminUpdateOrderStatus(803, { orderStatus: 'CANCELLED' }, store1Staff)
      ).rejects.toThrow(/Invalid status transition: Cannot move order from SHIPPING to CANCELLED/i);

      // 3. Admin attempts to cancel order currently in COMPLETED status
      tx.orders.findFirst.mockResolvedValueOnce({
        id: 804,
        order_code: 'ORD-804',
        order_status: 'COMPLETED',
        export_facility_id: 1,
      });

      await expect(
        adminOrderService.adminUpdateOrderStatus(804, { orderStatus: 'CANCELLED' }, store1Staff)
      ).rejects.toThrow(/Invalid status transition: Cannot move order from COMPLETED to CANCELLED/i);
    });
  });

  describe('PACK-01: Package UID Validation (Format, Existence, and Product Matching)', () => {
    const validUid = '11111111-1111-4111-8111-111111111111';
    const baseOrder = {
      id: 901,
      order_code: 'ORD-901',
      order_status: 'PROCESSING',
      export_facility_id: 1,
      payment_method: 'COD',
      total_amount: 50000,
      shipments: null,
      order_items: [
        {
          id: 91,
          medicine_id: 50,
          medicine_name: 'Andol S Tablets',
          unit_name: 'Box',
          quantity: 1,
          variant_id: 12,
          inventory_reserved: true,
          assigned_uids: [validUid],
        },
      ],
    };

    it('rejects packing request if physical package UID does not exist or is not at the export facility', async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        orders: { findFirst: jest.fn().mockResolvedValue(baseOrder) },
        medicine_boxes: {
          // Non-existent UID returns empty array
          findMany: jest.fn().mockResolvedValue([]),
        },
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const adminOrderService = new AdminOrderService(prisma as never);

      await expect(
        adminOrderService.adminPackOrder(901, { boxUids: ['NON-EXISTENT-UID-999'] }, store1Staff)
      ).rejects.toThrow(/invalid, already dispatched, or not at the export facility/i);
    });

    it('rejects packing request if scanned package UID belongs to a different medicine product', async () => {
      const wrongMedUid = '22222222-2222-4222-8222-222222222222';
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        orders: { findFirst: jest.fn().mockResolvedValue(baseOrder) },
        medicine_boxes: {
          findMany: jest.fn().mockResolvedValue([
            {
              uid: wrongMedUid,
              status: 'IN_STOCK',
              current_facility_id: 1,
              batch_id: 99,
              medicine_batches: { medicine_id: 999 }, // Mismatched medicine ID (expected 50)
            },
          ]),
        },
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const adminOrderService = new AdminOrderService(prisma as never);

      await expect(
        adminOrderService.adminPackOrder(901, { boxUids: [wrongMedUid] }, store1Staff)
      ).rejects.toThrow(/Verified packages do not match medicine "Andol S Tablets"/i);
    });

    it('rejects packing request if scanned package is reserved for another order', async () => {
      const otherReservedUid = '33333333-3333-4333-8333-333333333333';
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        orders: { findFirst: jest.fn().mockResolvedValue(baseOrder) },
        medicine_boxes: {
          findMany: jest.fn().mockResolvedValue([
            {
              uid: otherReservedUid,
              status: 'RESERVED', // Reserved for a different order
              current_facility_id: 1,
              batch_id: 10,
              medicine_batches: { medicine_id: 50 },
            },
          ]),
        },
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const adminOrderService = new AdminOrderService(prisma as never);

      await expect(
        adminOrderService.adminPackOrder(901, { boxUids: [otherReservedUid] }, store1Staff)
      ).rejects.toThrow(/A scanned package is reserved for another order/i);
    });
  });

  describe('PACK-02: Duplicate UID Rejection and Quantity Enforcement', () => {
    const singleItemOrder = {
      id: 902,
      order_code: 'ORD-902',
      order_status: 'PROCESSING',
      export_facility_id: 1,
      order_items: [
        {
          id: 92,
          medicine_id: 50,
          medicine_name: 'Andol S Tablets',
          unit_name: 'Box',
          quantity: 2, // Requires exactly 2 boxes
          variant_id: 12,
          inventory_reserved: true,
          assigned_uids: ['UID-AAA', 'UID-BBB'],
        },
      ],
    };

    it('rejects packing requests with duplicate UIDs in the submitted list', async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        orders: { findFirst: jest.fn().mockResolvedValue(singleItemOrder) },
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const adminOrderService = new AdminOrderService(prisma as never);

      // Same UID scanned twice: ['UID-AAA', 'UID-AAA']
      await expect(
        adminOrderService.adminPackOrder(902, { boxUids: ['UID-AAA', 'UID-AAA'] }, store1Staff)
      ).rejects.toThrow(/Duplicate box UIDs detected in packing request/i);
    });

    it.each([
      [['UID-AAA'], /Received 1 of 2 required UID\(s\)/i],
      [['UID-AAA', 'UID-BBB', 'UID-CCC'], /Received 3 of 2 required UID\(s\)/i],
    ])('rejects packing with the wrong UID count: %j', async (boxUids, error) => {
      const tx = { $queryRaw: jest.fn().mockResolvedValue([]), orders: { findFirst: jest.fn().mockResolvedValue(singleItemOrder) } };
      const service = new AdminOrderService({ withOrder: (_op, run) => run(tx) } as never);
      await expect(service.adminPackOrder(902, { boxUids }, store1Staff)).rejects.toThrow(error);
    });

  });

  describe('PACK-03: Concurrency Protection Against Duplicate Packing and Inventory Deduction', () => {
    it('prevents concurrent double fulfillment and double inventory deduction on simultaneous packing attempts', async () => {
      const targetUid = '11111111-1111-4111-8111-111111111111';
      let executionCount = 0;
      let orderCurrentStatus = 'PROCESSING';
      let existingShipment: any = null;

      const orderData = {
        id: 903,
        order_code: 'ORD-903',
        order_status: orderCurrentStatus,
        export_facility_id: 1,
        payment_method: 'COD',
        total_amount: 51600,
        shipments: existingShipment,
        order_items: [
          {
            id: 93,
            medicine_id: 50,
            medicine_name: 'Andol S Tablets',
            unit_name: 'Box',
            quantity: 1,
            variant_id: 12,
            inventory_reserved: true,
            assigned_uids: [targetUid],
          },
        ],
      };

      const inventoryMock = {
        stock_quantity: 10,
        reserved_quantity: 1,
      };

      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 903 }]),
        orders: {
          findFirst: jest.fn().mockImplementation(() =>
            Promise.resolve({
              ...orderData,
              order_status: orderCurrentStatus,
              shipments: existingShipment,
            })
          ),
          update: jest.fn().mockImplementation(({ data }) => {
            orderCurrentStatus = data.order_status;
            return Promise.resolve({ ...orderData, order_status: orderCurrentStatus });
          }),
        },
        medicine_boxes: {
          findMany: jest.fn().mockResolvedValue([
            {
              uid: targetUid,
              status: 'RESERVED',
              current_facility_id: 1,
              batch_id: 5,
              medicine_batches: { medicine_id: 50 },
            },
          ]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        inventories: {
          findUnique: jest.fn().mockResolvedValue(inventoryMock),
        },
        batches: {
          findUnique: jest.fn().mockResolvedValue({ id: 5, remaining_quantity: 10 }),
          update: jest.fn().mockResolvedValue({}),
        },
        order_items: { update: jest.fn().mockResolvedValue({}) },
        inventory_logs: {
          create: jest.fn().mockImplementation(() => {
            executionCount++;
            return Promise.resolve({ id: executionCount });
          }),
        },
        shipments: {
          create: jest.fn().mockImplementation(({ data }) => {
            existingShipment = { id: 777, ...data };
            return Promise.resolve(existingShipment);
          }),
        },
        $executeRaw: jest.fn().mockResolvedValue(1),
      };

      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const adminOrderService = new AdminOrderService(prisma as never);

      // Staff Member 1 completes packing successfully
      const staff1Result = await adminOrderService.adminPackOrder(903, { boxUids: [targetUid] }, store1Staff);
      expect(staff1Result.orderStatus).toBe('PENDING_PICKUP');
      expect(executionCount).toBe(1); // Exactly 1 inventory deduction log created
      expect(tx.shipments.create).toHaveBeenCalledTimes(1);

      // Staff Member 2 opens same order simultaneously and submits packing
      // Row lock and updated status check prevents duplicate packing:
      await expect(
        adminOrderService.adminPackOrder(903, { boxUids: [targetUid], courierName: 'J&T' }, store2Staff)
      ).rejects.toThrow(/Only orders with status PENDING or PROCESSING can be packed/i);

      // Assert: Inventory deduction was never executed a second time!
      expect(executionCount).toBe(1);
      expect(tx.shipments.create).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Logistics Comprehensive Workflow Matrix (Scopes 1 - 6)', () => {
  const storeStaff: CurrentUserPayload = {
    id: 10,
    role: 'STORE_MANAGER',
    type: 'employee',
    facilityId: 1,
  };

  const warehouseStaff: CurrentUserPayload = {
    id: 20,
    role: 'WAREHOUSE_STAFF',
    type: 'employee',
    facilityId: 2,
  };

  describe('Scope 1: Return-to-origin after order cancellation', () => {

    it('halts and returns an in-transit transfer when requested by staff', async () => {
      const tx = {
        internal_transfers: {
          findFirst: jest.fn()
            .mockResolvedValueOnce({
              id: 201,
              transfer_code: 'TR-201',
              status: 'DISPATCHED',
              from_facility_id: 2,
              to_facility_id: 1,
            })
            .mockResolvedValueOnce({
              id: 201,
              transfer_code: 'TR-201',
              status: 'RETURN_REQUESTED',
              from_facility_id: 2,
              to_facility_id: 1,
            }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const service = new InternalTransferService(prisma as never);

      const result = await service.adminHaltAndReturnTransfer(
        201,
        { reason: 'Customer changed delivery address; halt transfer' },
        warehouseStaff,
      );

      expect(tx.internal_transfers.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 201, status: 'DISPATCHED' },
          data: expect.objectContaining({
            status: 'RETURN_REQUESTED',
            return_reason: 'Customer changed delivery address; halt transfer',
          }),
        }),
      );
      expect(result?.status).toBe('RETURN_REQUESTED');
    });

    it('receives returned transfer at source with physical inspection before restocking', async () => {
      const tx = {
        internal_transfers: {
          findFirst: jest.fn().mockResolvedValue({
            id: 202,
            order_id: 999,
            transfer_code: 'TR-202',
            status: 'RETURN_REQUESTED',
            from_facility_id: 2,
            to_facility_id: 1,
            items: [{ variantId: 5, medicineId: 10, quantity: 5 }],
            orders: { order_code: 'ORD-999', order_items: [{ variant_id: 5, source_facility_id: 2, inventory_reserved: true, quantity: 5, assigned_uids: [] }] },
          }),
          update: jest.fn().mockResolvedValue({ id: 202, status: 'RETURNED_TO_SOURCE' }),
        },
        order_items: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        $queryRaw: jest.fn().mockImplementation((strings: TemplateStringsArray) => Promise.resolve(strings.join('').includes('available_quantity') ? [{ available_quantity: 4 }] : strings.join('').includes('RETURNING "stock_quantity"') ? [{ stock_quantity: 5 }] : [])),
        $executeRaw: jest.fn().mockResolvedValue(1),
        inventory_logs: { create: jest.fn().mockResolvedValue({ id: 1 }) },
        inventories: { update: jest.fn() },
        orders: { update: jest.fn() },
        cashbook_logs: { create: jest.fn() },
        medicine_boxes: { updateMany: jest.fn() },
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const service = new InternalTransferService(prisma as never);

      await expect(service.adminReceiveTransferReturn(202, undefined, warehouseStaff))
        .rejects.toThrow(/include every transfer variant/i);
      expect(tx.$executeRaw).not.toHaveBeenCalled();

      // Warehouse receives 4 good units and 1 damaged unit
      await service.adminReceiveTransferReturn(
        202,
        {
          lines: [{ variantId: 5, goodQuantity: 4, damagedQuantity: 1 }],
          notes: 'Box dropped during transit return',
        },
        warehouseStaff,
      );

      // Verify good stock is restocked
      expect(tx.inventory_logs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            transaction_type: 'TRANSFER_RETURN_RESTOCK',
            stock_bucket: 'AVAILABLE',
            quantity_changed: 4,
            previous_quantity: 0,
            new_quantity: 4,
          }),
        }),
      );
      // Damaged goods enter quarantine without a second deduction from source on-hand stock.
      expect(tx.$executeRaw.mock.calls.some(([sql]) => sql.join('').includes('record_quarantine_movement'))).toBe(true);
      expect(tx.internal_transfers.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'RETURNED_TO_SOURCE' }),
        }),
      );
    });
  });

  describe('Scope 2: Internal transfers & partial shortage/damage receipt', () => {
    it('receives partial delivery (8 good, 1 damaged, 1 missing) and records discrepancy details without failing whole shipment', async () => {
      const tx = {
        $queryRaw: jest.fn()
          .mockResolvedValueOnce([{ id: 801 }]) // order lock
          .mockResolvedValueOnce([{ stock_quantity: 10 }]), // deduct source stock
        internal_transfers: {
          findFirst: jest.fn().mockResolvedValue({
            id: 301,
            transfer_code: 'TR-301',
            status: 'DISPATCHED',
            from_facility_id: 2,
            to_facility_id: 1,
            order_id: 801,
            items: [{ variantId: 5, medicineId: 10, quantity: 10 }],
            orders: {
              order_code: 'ORD-801',
              order_status: 'WAITING_INTERNAL_TRANSFER',
              prescription_review_status: 'APPROVED',
              order_items: [
                {
                  id: 15,
                  variant_id: 5,
                  medicine_id: 10,
                  quantity: 10,
                  source_facility_id: 2,
                  inventory_reserved: true,
                  assigned_uids: ['UID-1', 'UID-2', 'UID-3', 'UID-4', 'UID-5', 'UID-6', 'UID-7', 'UID-8', 'UID-9', 'UID-10'],
                  unit_name: 'Tablet',
                },
              ],
            },
          }),
          update: jest.fn().mockResolvedValue({ id: 301 }),
          count: jest.fn().mockResolvedValue(0),
          findUnique: jest.fn().mockResolvedValue({ id: 301, status: 'RECEIVED_WITH_DISCREPANCY' }),
        },
        inventories: {
          findFirst: jest.fn().mockResolvedValue({ id: 50, stock_quantity: 0 }),
          update: jest.fn().mockResolvedValue({ id: 50, stock_quantity: 8 }),
        },
        medicine_boxes: {
          findMany: jest.fn().mockResolvedValue([]),
          updateMany: jest.fn().mockImplementation(({ where }) => Promise.resolve({ count: where.uid.in.length })),
        },
        inventory_logs: { create: jest.fn().mockResolvedValue({ id: 1 }) },
        order_items: { update: jest.fn() },
        orders: { update: jest.fn() },
        $executeRaw: jest.fn().mockResolvedValue(1),
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const service = new InternalTransferService(prisma as never);

      const result = await service.adminReceiveInternalTransfer(
        301,
        storeStaff,
        {
          lines: [
            {
              variantId: 5,
              receivedQuantity: 8,
              goodUids: ['UID-1', 'UID-2', 'UID-3', 'UID-4', 'UID-5', 'UID-6', 'UID-7', 'UID-8'],
              damagedUids: ['UID-9'],
              damagedQuantity: 1,
              missingQuantity: 1,
              notes: '1 box crushed, 1 blister pack missing from container',
            },
          ],
        },
      );

      // Verify good quantity incremented at destination
      expect(tx.inventories.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stock_quantity: { increment: 8 },
            reserved_quantity: { increment: 0 },
          }),
        }),
      );
      expect(tx.$executeRaw.mock.calls.some(([sql]) => sql.join('').includes('record_quarantine_movement'))).toBe(true);
      // Missing goods recorded as transit loss
      expect(tx.inventory_logs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            transaction_type: 'TRANSFER_LOSS',
            quantity_changed: -1,
          }),
        }),
      );
      // Transfer marked with discrepancy
      expect(tx.internal_transfers.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'RECEIVED_WITH_DISCREPANCY',
            discrepancy_status: 'DISCREPANCY',
          }),
        }),
      );
      expect(result?.status).toBe('RECEIVED_WITH_DISCREPANCY');
    });

    it('rejects receipt if line breakdown does not match the total dispatched quantity', async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValueOnce([{ id: 802 }]),
        internal_transfers: {
          findFirst: jest.fn().mockResolvedValue({
            id: 302,
            transfer_code: 'TR-302',
            status: 'DISPATCHED',
            from_facility_id: 2,
            to_facility_id: 1,
            order_id: 802,
            items: [{ variantId: 5, medicineId: 10, quantity: 10 }],
            orders: {
              order_code: 'ORD-802',
              order_status: 'WAITING_INTERNAL_TRANSFER',
              prescription_review_status: 'APPROVED',
              order_items: [
                { id: 16, variant_id: 5, quantity: 10, source_facility_id: 2, inventory_reserved: true },
              ],
            },
          }),
        },
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const service = new InternalTransferService(prisma as never);

      // 5 + 2 + 1 = 8 != 10
      await expect(
        service.adminReceiveInternalTransfer(302, storeStaff, {
          lines: [{ variantId: 5, receivedQuantity: 5, damagedQuantity: 2, missingQuantity: 1 }],
        }),
      ).rejects.toThrow(/do not sum to transferred quantity/i);
    });
  });

  describe('Scope 3: Proof of Delivery (PoD) and customer dispute', () => {
    it('allows authorized staff to record delivery with photo / signature proof without customer button block', async () => {
      const tx = {
        shipments: {
          findFirst: jest.fn()
            .mockResolvedValueOnce({
              id: 401,
              shipping_status: 'IN_TRANSIT',
              order_id: 701,
              orders: { id: 701, order_status: 'SHIPPING' },
            })
            .mockResolvedValueOnce({
              id: 401,
              shipping_status: 'DELIVERED',
              proof_type: 'DELIVERY_PHOTO',
              proof_reference: 'https://cdn.pharmatrace.vn/pod/photo-401.jpg',
            }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        orders: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const service = new LogisticsService(prisma as never);

      const result = await service.confirmDeliveryWithProof(
        401,
        {
          proofType: 'DELIVERY_PHOTO',
          proofReference: 'https://cdn.pharmatrace.vn/pod/photo-401.jpg',
          deliveredToName: 'Nguyen Van A (Recipient brother)',
          deliveryNotes: 'Handed package to recipient family member at gate',
        },
        storeStaff,
      );

      expect(tx.shipments.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 401, shipping_status: 'IN_TRANSIT' },
          data: expect.objectContaining({
            shipping_status: 'DELIVERED',
            proof_type: 'DELIVERY_PHOTO',
            proof_reference: 'https://cdn.pharmatrace.vn/pod/photo-401.jpg',
            delivered_to_name: 'Nguyen Van A (Recipient brother)',
          }),
        }),
      );
      // Order automatically transitions to COMPLETED
      expect(tx.orders.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 701, order_status: 'SHIPPING' },
          data: { order_status: 'COMPLETED' },
        }),
      );
      expect(result?.shipping_status).toBe('DELIVERED');
    });

    it.each(['proofType', 'proofReference', 'deliveredToName'] as const)('rejects PoD without %s', async (missing) => {
      const prisma = { withOrder: jest.fn() };
      const service = new LogisticsService(prisma as never);

      await expect(
        service.confirmDeliveryWithProof(
          402,
          {
            proofType: 'CUSTOMER_SIGNATURE', proofReference: 'signature-402', deliveredToName: 'Nguyen Van B',
            [missing]: '',
          },
          storeStaff,
        ),
      ).rejects.toThrow(/Proof type, proof reference, and delivered-to recipient name are required/i);
      expect(prisma.withOrder).not.toHaveBeenCalled();
    });

    it('allows customer to submit a delivery dispute if they did not receive package', async () => {
      const tx = {
        shipments: {
          findFirst: jest.fn().mockResolvedValue({
            id: 403,
            order_id: 702,
            shipping_status: 'DELIVERED',
            delivery_notes: 'Left at reception',
            orders: { customer_id: 99, order_status: 'COMPLETED' },
          }),
          update: jest.fn().mockResolvedValue({ id: 403 }),
        },
        $queryRaw: jest.fn().mockResolvedValue([{ result: 'SUBMITTED' }]),
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const service = new LogisticsService(prisma as never);

      const result = await service.disputeDelivery(
        702,
        99,
        'I was not home and neighbor did not receive this delivery',
      );

      expect(prisma.withOrder).toHaveBeenCalledWith('customer_receive', expect.any(Function), expect.objectContaining({ id: 99, role: 'CUSTOMER' }));
      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('Scope 4: Returns and QA disposition (failed delivery vs post-delivery RMA)', () => {
    it('handles failed delivery return by intake into quarantine without automatic refund or resale', async () => {
      const tx = {
        shipments: {
          findFirst: jest.fn().mockResolvedValue({
            id: 501,
            shipping_status: 'RETURN_REQUESTED',
            tracking_number: 'TRACK-501',
            orders: {
              order_code: 'ORD-501',
              export_facility_id: 1,
              order_items: [{ id: 21, variant_id: 7, medicine_id: 30, quantity: 2, assigned_uids: [] }],
            },
          }),
          update: jest.fn().mockResolvedValue({ id: 501 }),
        },
        inventory_logs: { create: jest.fn().mockResolvedValue({ id: 1 }) },
        inventories: { update: jest.fn() },
        orders: { update: jest.fn() },
        cashbook_logs: { create: jest.fn() },
        medicine_boxes: { updateMany: jest.fn() },
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest.fn().mockResolvedValue([]),
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const service = new LogisticsService(prisma as never);

      await service.receiveReturn(501, { notes: 'Returned by carrier after 3 failed attempts', receivedLines: [{ variantId: 7, quantity: 2 }] }, warehouseStaff);
      expect(tx.inventories.update).not.toHaveBeenCalled();
      expect(tx.orders.update).not.toHaveBeenCalled();
      expect(tx.cashbook_logs.create).not.toHaveBeenCalled();

      expect(tx.$executeRaw.mock.calls.some(([sql]) => sql.join('').includes('record_quarantine_movement'))).toBe(true);
      expect(tx.shipments.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            shipping_status: 'RETURNED_TO_WAREHOUSE',
            return_qa_status: 'PENDING_INSPECTION',
          }),
        }),
      );
    });

    it('performs QA disposition: passed items restocked, failed items marked as scrap', async () => {
      const tx = {
        shipments: {
          findFirst: jest.fn().mockResolvedValue({
            id: 502,
            shipping_status: 'RETURNED_TO_WAREHOUSE',
            return_qa_status: 'PENDING_INSPECTION',
            tracking_number: 'TRACK-502',
            orders: {
              export_facility_id: 1,
              order_items: [
                {
                  id: 22,
                  variant_id: 7,
                  medicine_id: 30,
                  quantity: 4,
                  assigned_uids: ['BOX-1', 'BOX-2', 'BOX-3', 'BOX-4'],
                },
              ],
            },
          }),
          update: jest.fn().mockResolvedValue({ id: 502 }),
        },
        inventories: {
          upsert: jest.fn().mockResolvedValue({ id: 70, stock_quantity: 12 }),
        },
        medicine_boxes: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
        orders: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        inventory_logs: { create: jest.fn().mockResolvedValue({ id: 1 }) },
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest.fn().mockImplementation((strings: TemplateStringsArray) => Promise.resolve(strings.join('').includes('shipment_return_items') ? [{ variant_id: 7, quantity: 4, box_uids: ['BOX-1', 'BOX-2', 'BOX-3', 'BOX-4'] }] : [])),
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const service = new LogisticsService(prisma as never);

      // QA assesses 2 units passed (unopened seal), 2 units failed (broken seal)
      const result = await service.dispositionReturn(
        502,
        {
          decision: 'PARTIAL_RESTOCK',
          qaNotes: '2 packs intact and refrigerated; 2 packs opened by customer',
          lines: [
            {
              variantId: 7,
              passQuantity: 2,
              failQuantity: 2,
              restockBoxUids: ['BOX-1', 'BOX-2'],
              scrapBoxUids: ['BOX-3', 'BOX-4'],
              notes: 'Passed 2 units, failed 2 units',
            },
          ],
        },
        warehouseStaff,
      );

      // Verify restocked quantity
      expect(tx.inventories.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ stock_quantity: { increment: 2 } }),
        }),
      );
      expect(tx.inventory_logs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ transaction_type: 'RETURN_RESTOCK', quantity_changed: 2, previous_quantity: 10, new_quantity: 12 }),
        }),
      );
      expect(tx.$executeRaw.mock.calls.some(([sql]) => sql.join('').includes('FAILED_QA'))).toBe(true);
      expect(result?.shipping_status).toBe('RETURNED_TO_WAREHOUSE');
    });
  });

  describe('Scope 5: COD reconciliation database boundary', () => {
    it('submits a statement for approval without settling it directly', async () => {
      const result = { id: 10, shipmentId: 601, status: 'PENDING' };
      const tx = { $queryRaw: jest.fn().mockResolvedValue([{ result }]) };
      const service = new LogisticsService({ withOrder: (_op, run) => run(tx) } as never);
      await expect(service.reconcileCod(601, { grossAmount: 500000, courierFee: 25000, netAmount: 475000, statementReference: 'STMT-1' }, storeStaff)).resolves.toEqual(result);
      expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain('submit_cod_statement');
    });

    it.each(['SETTLED', 'DISCREPANCY_PENDING'])('returns approval result %s', async status => {
      const result = { shipmentId: 601, status, netAmount: 475000 };
      const tx = { $queryRaw: jest.fn().mockResolvedValue([{ result }]) };
      const service = new LogisticsService({ withOrder: (_op, run) => run(tx) } as never);
      await expect(service.approveCodStatement(601, 10, storeStaff)).resolves.toEqual(result);
      expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain('approve_cod_statement');
    });
  });

  describe('Scope 6: Quotation and fulfillment options', () => {
    it('calculates consistent shipping fee, estimated hours, and serviceability between quote and order', () => {
      // Local delivery (<= 15 km)
      const localEstimate = calculateEstimatedDelivery(8.5, false);
      expect(localEstimate.isServiceable).toBe(true);
      expect(localEstimate.estimatedHours).toBe(4);
      expect(localEstimate.label).toContain('same-day');

      // Provincial transfer (consolidated)
      const consolidatedEstimate = calculateEstimatedDelivery(45, true);
      expect(consolidatedEstimate.isServiceable).toBe(true);
      expect(consolidatedEstimate.estimatedHours).toBe(48); // 24 + 24
      expect(consolidatedEstimate.label).toContain('24 hours for consolidation');

      // Unserviceable coordinates (> 2500 km)
      const unserviceable = calculateEstimatedDelivery(3500, false);
      expect(unserviceable.isServiceable).toBe(false);
      expect(unserviceable.label).toContain('outside delivery coverage');
    });

    it('enforces quotation confirmation guard: rejects order if quotation changed and customer has not accepted', async () => {
      const mockPrisma = {
        $queryRaw: jest.fn().mockResolvedValue([{ facility_id: 1, selling_facility_id: 1, selling_facility_name: 'Pharmacy', radius_km: 3000, revision: 'v1', requirements_revision: 'v1' }]),
        customers: {
          findUnique: jest.fn().mockResolvedValue({ id: 99, full_name: 'Customer 99' }),
        },
        packaging_variants: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 1,
              price: 100000,
              discount_percentage: 0,
              unit_name: 'Box',
              medicine: { id: 10, medicine_name: 'Medicine A', status: 'ACTIVE', is_prescription: false },
            },
          ]),
        },
        facilities: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 1,
              facility_name: 'Store 1',
              latitude: 10.77,
              longitude: 106.70,
              facility_type: 'RETAIL',
              inventories: [
                {
                  variant_id: 1,
                  stock_quantity: 10,
                  reserved_quantity: 0,
                },
              ],
            },
          ]),
        },
        withAuth: jest.fn((run) => run(mockPrisma)),
        withVoucher: jest.fn((_scope, run) => run(mockPrisma)),
        prepareVoucher: jest.fn().mockResolvedValue(undefined),
        withOrder: jest.fn((_op, cb) => cb(mockPrisma)),
      };

      const orderService = new OrderService(mockPrisma as never);

      // Order payload with mismatched accepted quoted shipping fee
      const orderPayload = {
        items: [{ variantId: 1, quantity: 1 }],
        paymentMethod: 'COD' as const,
        recipientName: 'Customer 99',
        recipientPhone: '0901234567',
        shippingAddress: '123 Nguyen Hue, District 1, HCMC',
        latitude: 10.775,
        longitude: 106.705,
        expectedShippingFee: 10000, // Stale quote! Real calculation is 15,000 VND
        expectedTotalAmount: 110000,
      };

      await expect(
        orderService.createOrder(99, orderPayload),
      ).rejects.toThrow(/delivery quote has changed/i);
    });
  });
});
