import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
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

  // =========================================================================
  // TRF-01: Multi-facility access control for internal transfers
  // =========================================================================
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

  // =========================================================================
  // TRF-02: Sequence validation, idempotent cancellation, and dispatch rules
  // =========================================================================
  describe('TRF-02: Sequence Validation, Idempotent Cancellation, and Dispatch Prerequisites', () => {
    it('prevents cancellation of received transfers (RECEIVED) and prevents duplicate cancellation attempts', async () => {
      const tx = {
        internal_transfers: {
          findFirst: jest.fn().mockResolvedValue({ id: 202, status: 'RECEIVED', from_facility_id: 1 }),
        },
        $queryRaw: jest.fn(),
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const transferService = new InternalTransferService(prisma as never);

      // Already received transfer cannot be cancelled
      await expect(transferService.cancelTransfer(202, store1Staff)).rejects.toThrow(/unshipped transfer can be cancelled/i);

      // Prevents duplicate cancellation if DB procedure indicates already processed
      tx.internal_transfers.findFirst.mockResolvedValueOnce({ id: 203, status: 'REQUESTED', from_facility_id: 1 });
      tx.$queryRaw.mockResolvedValueOnce([{ cancelled: false }]);
      await expect(transferService.cancelTransfer(203, store1Staff)).rejects.toThrow(/retry/i);
    });

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

  // =========================================================================
  // SHIP-01: Carrier confirmation and delivery status validation
  // =========================================================================
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

    it('requires a non-empty failure reason when recording delivery failure (DELIVERY_FAILED)', async () => {
      const tx = { shipments: { findFirst: jest.fn(), updateMany: jest.fn() }, $queryRaw: jest.fn() };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const logisticsService = new LogisticsService(prisma as never);

      await expect(
        logisticsService.changeStatus(302, { status: 'DELIVERY_FAILED', reason: '' }, store1Staff)
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('prohibits warehouse staff from manually marking shipments as DELIVERED (customer receipt only)', async () => {
      const tx = { shipments: { findFirst: jest.fn(), updateMany: jest.fn() }, $queryRaw: jest.fn() };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const logisticsService = new LogisticsService(prisma as never);

      await expect(
        logisticsService.changeStatus(303, { status: 'DELIVERED' }, store1Staff)
      ).rejects.toThrow(/customer can confirm receipt/i);
    });
  });

  // =========================================================================
  // SHIP-02: Shipment lifecycle and inventory preservation
  // =========================================================================
  describe('SHIP-02: Sequential Shipment Lifecycle and Inventory Preservation', () => {
    it('progresses shipment statuses sequentially without redundant inventory deductions during shipping', async () => {
      let currentStatus = 'PENDING_PICKUP';
      const tx = {
        shipments: {
          findFirst: jest.fn().mockImplementation(() =>
            Promise.resolve({
              id: 401,
              shipping_status: currentStatus,
              carrier_confirmed_at: new Date(),
            })
          ),
          updateMany: jest.fn().mockImplementation(({ data }) => {
            if (data?.shipping_status) currentStatus = data.shipping_status;
            return Promise.resolve({ count: 1 });
          }),
        },
        orders: { updateMany: jest.fn() },
        $queryRaw: jest.fn().mockResolvedValue([]),
        $executeRaw: jest.fn(),
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const logisticsService = new LogisticsService(prisma as never);

      // Step 1: Picked up by courier
      await logisticsService.changeStatus(401, { status: 'PICKED_UP' }, store1Staff);
      expect(currentStatus).toBe('PICKED_UP');

      // Step 2: In transit to recipient
      await logisticsService.changeStatus(401, { status: 'IN_TRANSIT' }, store1Staff);
      expect(currentStatus).toBe('IN_TRANSIT');

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

  // =========================================================================
  // SHIP-03: Concurrent dual-tab receipt handling and idempotency
  // =========================================================================
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

  // =========================================================================
  // COD-01: Cash-on-Delivery collection prerequisites and duplicate prevention
  // =========================================================================
  describe('COD-01: Cash-on-Delivery (COD) Reconciliation and Idempotent Cashbook Logging', () => {
    it('blocks COD collection for undelivered shipments', async () => {
      const tx = {
        shipments: {
          findFirst: jest.fn().mockResolvedValue({
            id: 601,
            shipping_status: 'IN_TRANSIT', // not yet DELIVERED
            cod_settlement_status: 'UNSETTLED',
            cod_amount: 150000,
          }),
        },
        $queryRaw: jest.fn().mockResolvedValueOnce([{ executable: true }]).mockResolvedValueOnce([{ cashbook_id: null }]),
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const logisticsService = new LogisticsService(prisma as never);

      await expect(logisticsService.collect(601, store1Staff)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('successfully collects COD for delivered shipments and returns identical receipt without duplicate entry on retry', async () => {
      const tx = {
        shipments: {
          findFirst: jest.fn().mockResolvedValue({
            id: 602,
            shipping_status: 'DELIVERED',
            cod_settlement_status: 'UNSETTLED',
            cod_amount: 200000,
          }),
        },
        $queryRaw: jest.fn()
          .mockResolvedValueOnce([{ executable: true }])
          .mockResolvedValueOnce([{ cashbook_id: 888 }]) // 1st attempt creates cashbook entry #888
          .mockResolvedValueOnce([{ executable: true }])
          .mockResolvedValueOnce([{ cashbook_id: 888 }]), // 2nd attempt returns same cashbook entry #888
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const logisticsService = new LogisticsService(prisma as never);

      // First collection attempt
      const res1 = await logisticsService.collect(602, store1Staff);
      expect(res1).toEqual({ shipmentId: 602, cashbookId: 888 });

      // Second redundant attempt
      const res2 = await logisticsService.collect(602, store1Staff);
      expect(res2).toEqual({ shipmentId: 602, cashbookId: 888 });
    });
  });

  // =========================================================================
  // SHIP-04: Return flow isolation (RMA requirement and refund separation)
  // =========================================================================
  describe('SHIP-04: Return Logistics Flow and Inventory/Refund Decoupling', () => {
    it('confirms return to warehouse without automatically refunding money or restoring stock without inspection', async () => {
      const tx = {
        shipments: {
          findFirst: jest.fn().mockResolvedValue({
            id: 701,
            shipping_status: 'DELIVERY_FAILED',
            actual_delivery_at: null,
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        inventories: { update: jest.fn() },
        orders: { update: jest.fn() },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const logisticsService = new LogisticsService(prisma as never);

      await logisticsService.requestReturn(701, 'Customer rejected delivery at door', store1Staff);

      expect(tx.shipments.updateMany).toHaveBeenCalledWith({
        where: { id: 701, shipping_status: 'DELIVERY_FAILED' },
        data: { shipping_status: 'RETURN_REQUESTED' },
      });

      // Crucial: No automated inventory or monetary refund occurs prior to formal inspection
      expect(tx.inventories.update).not.toHaveBeenCalled();
      expect(tx.orders.update).not.toHaveBeenCalled();
    });

    it('requires formal RMA workflow approval for delivered orders before accepting returns', async () => {
      const tx = {
        shipments: {
          findFirst: jest.fn().mockResolvedValue({
            id: 702,
            shipping_status: 'DELIVERED',
            actual_delivery_at: new Date(),
          }),
          updateMany: jest.fn(),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const logisticsService = new LogisticsService(prisma as never);

      await expect(
        logisticsService.requestReturn(702, 'Customer requested return after delivery', store1Staff)
      ).rejects.toThrow(/RMA/i);

      expect(tx.shipments.updateMany).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // ORD-01: Order data consistency across customer and admin management views
  // =========================================================================
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
        $queryRaw: jest.fn(),
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

  // =========================================================================
  // ORD-02: State-dependent cancellation rules and immutability
  // =========================================================================
  describe('ORD-02: State-Dependent Order Cancellation Rules & Immutability', () => {
    it('allows cancellation when order is PENDING or WAITING_INTERNAL_TRANSFER, releasing reservations and restoring loyalty points', async () => {
      const orderRecord = {
        id: 802,
        order_code: 'ORD-802',
        customer_id: customerUser.id,
        order_status: 'PENDING',
        export_facility_id: 1,
        used_points: 300,
      };

      const tx = {
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
        internal_transfers: { updateMany: jest.fn() },
        customers: { update: jest.fn().mockResolvedValue({}) },
        loyalty_point_logs: { create: jest.fn().mockResolvedValue({}) },
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest.fn().mockResolvedValue([]),
      };

      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const orderService = new OrderService(prisma as never);

      const cancelledOrder = await orderService.cancelMyOrder(customerUser.id, 802);
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
        orderService.cancelMyOrder(customerUser.id, 803)
      ).rejects.toThrow(/Only orders with status PENDING or WAITING_INTERNAL_TRANSFER can be cancelled/i);

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

  // =========================================================================
  // PACK-01: Package UID validation (format, existence, and product matching)
  // =========================================================================
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

  // =========================================================================
  // PACK-02: Duplicate UID rejection and quantity enforcement
  // =========================================================================
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

    it('rejects packing when fewer UIDs are scanned than the required order quantity', async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        orders: { findFirst: jest.fn().mockResolvedValue(singleItemOrder) },
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const adminOrderService = new AdminOrderService(prisma as never);

      // Order needs 2 boxes, but only 1 UID is scanned
      await expect(
        adminOrderService.adminPackOrder(902, { boxUids: ['UID-AAA'] }, store1Staff)
      ).rejects.toThrow(/Received 1 of 2 required UID\(s\)/i);
    });

    it('rejects packing when excess UIDs are scanned beyond the required order quantity', async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        orders: { findFirst: jest.fn().mockResolvedValue(singleItemOrder) },
      };
      const prisma = { withOrder: jest.fn((_op, cb) => cb(tx)) };
      const adminOrderService = new AdminOrderService(prisma as never);

      // Order needs 2 boxes, but 3 UIDs are submitted
      await expect(
        adminOrderService.adminPackOrder(902, { boxUids: ['UID-AAA', 'UID-BBB', 'UID-CCC'] }, store1Staff)
      ).rejects.toThrow(/Received 3 of 2 required UID\(s\)/i);
    });
  });

  // =========================================================================
  // PACK-03: Concurrency protection against duplicate packing & stock deduction
  // =========================================================================
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
      expect(staff1Result.orderStatus).toBe('SHIPPING');
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
