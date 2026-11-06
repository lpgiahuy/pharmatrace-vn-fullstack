import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { OrderService } from "./order.service";
import { geocodeAddress } from "./helpers/geocoding.helper";

jest.mock("./helpers/geocoding.helper", () => ({
  ...jest.requireActual("./helpers/geocoding.helper"),
  geocodeAddress: jest.fn(),
}));

describe("OrderService inventory reservation", () => {
  const customer = { id: 7, reward_points: 0 };
  const variant = {
    id: 11,
    medicine_id: 21,
    unit_name: "Box",
    price: 100_000,
    medicine: {
      medicine_name: "Test medicine",
      status: "ACTIVE",
      is_prescription: false,
    },
  };
  const facility = {
    id: 3,
    latitude: null,
    longitude: null,
    inventories: [
      {
        variant_id: variant.id,
        stock_quantity: 5,
        reserved_quantity: 0,
      },
    ],
  };
  const dto = {
    items: [{ variantId: variant.id, quantity: 1 }],
    shippingAddress: "38/14/14 Ao Đôi, TP.HCM",
    recipientName: "Customer",
    recipientPhone: "0900000000",
  };

  function createMocks(reservedInventoryRows: number | number[]) {
    const rawMock = jest.fn();
    if (Array.isArray(reservedInventoryRows)) {
      reservedInventoryRows.forEach((val) => rawMock.mockResolvedValueOnce(val));
    } else {
      rawMock.mockResolvedValue(reservedInventoryRows);
    }

    const tx = {
      orders: { create: jest.fn().mockResolvedValue({ id: 101 }) },
      order_items: { createMany: jest.fn() },
      vouchers: { update: jest.fn() },
      customers: { update: jest.fn() },
      loyalty_point_logs: { create: jest.fn() },
      cart_items: { deleteMany: jest.fn() },
      medicine_boxes: {
        findMany: jest.fn().mockResolvedValue([{ uid: "box-uid-1" }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      internal_transfers: { create: jest.fn() },
      $executeRaw: rawMock,
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
    };
    const prisma = {
      customers: { findUnique: jest.fn().mockResolvedValue(customer) },
      vouchers: {
        findFirst: jest.fn().mockResolvedValue({
          id: 99,
          voucher_code: "DISCOUNT10",
          status: "ACTIVE",
          discount_type: "FIXED",
          discount_value: 10000,
          total_quantity: 10,
          used_quantity: 9,
          min_order_value: 0,
        }),
      },
      packaging_variants: {
        findMany: jest.fn().mockResolvedValue([variant]),
      },
      facilities: { findMany: jest.fn().mockResolvedValue([facility]) },
      orders: {
        findUnique: jest.fn().mockResolvedValue({
          id: 101,
          customer_id: customer.id,
          order_items: [],
          shipments: null,
          prescriptions: null,
        }),
      },
      withAuth: jest.fn(run => run(prisma)),
      prepareVoucher: jest.fn().mockResolvedValue(undefined),
      withVoucher: jest.fn((_scope, run) => run(prisma)),
      withOrder: jest.fn(
        async (operation: unknown, callback: (client: any) => Promise<unknown>) =>
          callback(operation === "read" ? prisma : tx),
      ),
    };

    return { prisma, tx };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(geocodeAddress).mockResolvedValue(null);
  });

  it("atomically reserves inventory and a physical UID for a box variant", async () => {
    const { prisma, tx } = createMocks(1);
    const service = new OrderService(prisma);

    await service.createOrder(customer.id, dto);

    expect(prisma.withOrder).toHaveBeenCalledWith(
      "checkout", expect.any(Function), { id: customer.id, role: 'CUSTOMER', type: 'customer' },
    );
    expect(tx.cart_items.deleteMany).toHaveBeenCalledWith({
      where: { customer_id: customer.id, variant_id: { in: [variant.id] } },
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.medicine_boxes.updateMany).toHaveBeenCalledWith({
      where: {
        uid: { in: ["box-uid-1"] },
        current_facility_id: facility.id,
        status: {
          in: expect.arrayContaining(["IN_STOCK", "MANUFACTURED"]),
        },
      },
      data: { status: "RESERVED" },
    });
    expect(tx.order_items.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          variant_id: variant.id,
          assigned_uids: ["box-uid-1"],
          inventory_reserved: true,
        }),
      ],
    });
  });

  it("rejects the order when the atomic inventory reservation fails", async () => {
    const { prisma, tx } = createMocks(0);
    const service = new OrderService(prisma);

    await expect(service.createOrder(customer.id, dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.medicine_boxes.findMany).not.toHaveBeenCalled();
    expect(tx.order_items.createMany).not.toHaveBeenCalled();
  });

  it("accepts an order with aggregate stock before physical UIDs are available", async () => {
    const { prisma, tx } = createMocks(1);
    tx.medicine_boxes.findMany.mockResolvedValue([]);
    const service = new OrderService(prisma);

    await expect(service.createOrder(customer.id, dto)).resolves.toMatchObject({ id: 101 });

    expect(tx.medicine_boxes.updateMany).not.toHaveBeenCalled();
    expect(tx.order_items.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ assigned_uids: [], inventory_reserved: true })],
    });
  });

  it("uses the nearest facility even when a farther warehouse has every item", async () => {
    const { prisma, tx } = createMocks(1);
    prisma.facilities.findMany.mockResolvedValue([
      { ...facility, id: 20, latitude: 21.0, longitude: 105.8 },
      { ...facility, id: 10, latitude: 10.77, longitude: 106.70, inventories: [] },
    ]);
    tx.medicine_boxes.findMany.mockResolvedValue([]);
    const service = new OrderService(prisma);

    await service.createOrder(customer.id, { ...dto, latitude: 10.775, longitude: 106.705 });

    expect(tx.orders.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ export_facility_id: 10, order_status: 'WAITING_INTERNAL_TRANSFER' }),
    });
    expect(tx.internal_transfers.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        from_facility_id: 20, to_facility_id: 10, status: 'REQUESTED',
        items: [expect.objectContaining({ variantId: variant.id, quantity: 1 })],
      }),
    });
    expect(tx.order_items.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ source_facility_id: 20, assigned_uids: [], inventory_reserved: true })],
    });
  });

  it("atomically applies voucher and reward points", async () => {
    // 1st $executeRaw for inventory, 2nd for voucher, 3rd for customer points
    const { prisma, tx } = createMocks([1, 1, 1]);
    prisma.customers.findUnique.mockResolvedValue({ id: customer.id, reward_points: 500 });
    const service = new OrderService(prisma);

    await service.createOrder(customer.id, {
      ...dto,
      voucherCode: "DISCOUNT10",
      usedPoints: 100,
    });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(3);
    expect(tx.loyalty_point_logs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        points: -100,
        transaction_type: "REDEEM",
      }),
    });
  });

  it("rejects the order when voucher has no valid usage limit configured", async () => {
    const { prisma } = createMocks(1);
    prisma.vouchers.findFirst.mockResolvedValue({
      id: 99,
      voucher_code: "NOLIMIT",
      status: "ACTIVE",
      discount_type: "FIXED",
      discount_value: 10000,
      total_quantity: null,
      used_quantity: 0,
      min_order_value: 0,
    });
    const service = new OrderService(prisma);

    await expect(
      service.createOrder(customer.id, {
        ...dto,
        voucherCode: "NOLIMIT",
      }),
    ).rejects.toThrow("This voucher has no valid usage limit configured");
  });

  it("rejects the order when voucher total usage limit has already been reached", async () => {
    const { prisma } = createMocks(1);
    prisma.vouchers.findFirst.mockResolvedValue({
      id: 99,
      voucher_code: "EXHAUSTED",
      status: "ACTIVE",
      discount_type: "FIXED",
      discount_value: 10000,
      total_quantity: 10,
      used_quantity: 10,
      min_order_value: 0,
    });
    const service = new OrderService(prisma);

    await expect(
      service.createOrder(customer.id, {
        ...dto,
        voucherCode: "EXHAUSTED",
      }),
    ).rejects.toThrow("This voucher has reached its total usage limit");
  });

  it("rejects the order when concurrent race condition exhausts the voucher", async () => {
    // Inventory succeeds (1), but voucher update fails (0) due to race condition / exhausted limit
    const { prisma, tx } = createMocks([1, 0]);
    const service = new OrderService(prisma);

    await expect(
      service.createOrder(customer.id, {
        ...dto,
        voucherCode: "DISCOUNT10",
      }),
    ).rejects.toThrow("This voucher has reached its total usage limit or is no longer active");
  });

  it("creates WAITING_INTERNAL_TRANSFER order and prioritizes nearest facility B to facility A", async () => {
    const variant1 = {
      id: 101,
      medicine_id: 1,
      unit_name: "Box",
      price: 50_000,
      medicine: { medicine_name: "Medicine 1", status: "ACTIVE", is_prescription: false },
    };
    const variant2 = {
      id: 102,
      medicine_id: 2,
      unit_name: "Box",
      price: 80_000,
      medicine: { medicine_name: "Medicine 2", status: "ACTIVE", is_prescription: false },
    };

    // Facility A (HCM Central - 10.77, 106.70) has variant 1 only
    const facilityA = {
      id: 10,
      facility_name: "Warehouse A (Central HCM)",
      latitude: 10.77,
      longitude: 106.70,
      inventories: [{ variant_id: variant1.id, stock_quantity: 10, reserved_quantity: 0 }],
    };

    // Facility B (Tan Binh HCM - 10.80, 106.65, ~6km from A) has variant 2
    const facilityB = {
      id: 20,
      facility_name: "Warehouse B (Tan Binh - Near)",
      latitude: 10.80,
      longitude: 106.65,
      inventories: [{ variant_id: variant2.id, stock_quantity: 10, reserved_quantity: 0 }],
    };

    // Facility C (Hanoi - 21.00, 105.80, ~1100km from A) also has variant 2
    const facilityC = {
      id: 30,
      facility_name: "Warehouse C (Hanoi - Far)",
      latitude: 21.00,
      longitude: 105.80,
      inventories: [{ variant_id: variant2.id, stock_quantity: 10, reserved_quantity: 0 }],
    };

    const { prisma, tx } = createMocks([1, 1]); // 2 inventory reservations
    prisma.packaging_variants.findMany.mockResolvedValue([variant1, variant2]);
    // Note: C is returned before B to ensure distance sorting actually chooses B over C
    prisma.facilities.findMany.mockResolvedValue([facilityA, facilityC, facilityB]);

    const service = new OrderService(prisma);

    await service.createOrder(customer.id, {
      items: [
        { variantId: variant1.id, quantity: 1 },
        { variantId: variant2.id, quantity: 1 },
      ],
      shippingAddress: "District 1, Ho Chi Minh City",
      recipientName: "Customer Multi",
      recipientPhone: "0901234567",
      latitude: 10.775,
      longitude: 106.705,
    });

    // 1. Order status should be WAITING_INTERNAL_TRANSFER
    expect(tx.orders.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        export_facility_id: facilityA.id,
        order_status: "WAITING_INTERNAL_TRANSFER",
      }),
    });

    // 2. Transfer request should be created from nearest Facility B (id: 20), NOT far Facility C (id: 30)
    expect(tx.internal_transfers.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        from_facility_id: facilityB.id,
        to_facility_id: facilityA.id,
        status: "REQUESTED",
        items: expect.arrayContaining([
          expect.objectContaining({ variantId: variant2.id, quantity: 1 }),
        ]),
      }),
    });

    // 3. Line items should record correct source facilities
    expect(tx.order_items.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ variant_id: variant1.id, source_facility_id: facilityA.id }),
        expect.objectContaining({ variant_id: variant2.id, source_facility_id: facilityB.id }),
      ]),
    });
  });

  it("rejects when any item is out of stock across the entire network", async () => {
    const variant1 = {
      id: 201,
      medicine_id: 1,
      unit_name: "Box",
      price: 50_000,
      medicine: { medicine_name: "Medicine 1", status: "ACTIVE", is_prescription: false },
    };
    const { prisma } = createMocks([1]);
    prisma.packaging_variants.findMany.mockResolvedValue([variant1]);
    prisma.facilities.findMany.mockResolvedValue([
      {
        id: 1,
        facility_name: "Empty Warehouse",
        latitude: null,
        longitude: null,
        inventories: [],
      },
    ]);

    const service = new OrderService(prisma);

    await expect(
      service.createOrder(customer.id, {
        items: [{ variantId: variant1.id, quantity: 5 }],
        shippingAddress: "Somewhere",
        recipientName: "Customer",
        recipientPhone: "0900000000",
      }),
    ).rejects.toThrow("is out of stock across the entire fulfillment network");
  });
});
