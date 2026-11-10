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
    latitude: 10.77,
    longitude: 106.70,
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
      $executeRaw: jest.fn((sql, ...args) => sql.join('').includes('accept_fulfillment_terms') ? Promise.resolve(1) : rawMock(sql, ...args)),
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
      $queryRaw: jest.fn(async () => (await prisma.facilities.findMany()).map(f => ({ facility_id: f.id, selling_facility_id: f.id, selling_facility_name: 'Selling pharmacy', radius_km: 3000, revision: 'policy-v1', requirements_revision: 'requirements-v1' }))),
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
    jest.mocked(geocodeAddress).mockResolvedValue({ latitude: 10.77, longitude: 106.70, precision: "house" });
  });

  it('quotes without reserving inventory or creating an order', async () => {
    const { prisma, tx } = createMocks(1);
    const quote = await new OrderService(prisma).createOrder(customer.id, dto, true);
    expect(quote).toMatchObject({ shippingFee: 15000, totalAmount: 115000, facilityId: 3 });
    expect(tx.orders.create).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it.each([
    ['expired', '2026-04-01T00:00:00Z', '2026-04-22T00:00:00Z', 10800, 12000],
    ['future', '2026-12-01T00:00:00Z', '2026-12-31T00:00:00Z', 10800, 12000],
    ['missing dates', null, null, 10800, 12000],
    ['active', '2026-11-01T00:00:00Z', '2026-11-30T00:00:00Z', 10800, 10800],
    ['regular', null, null, 12000, 12000],
  ])('uses the effective price for an %s sale in the delivery quote', async (
    _name, start, end, price, expectedPrice,
  ) => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-10T06:00:00Z'));
    try {
      const { prisma, tx } = createMocks(1);
      prisma.packaging_variants.findMany.mockResolvedValue([{
        ...variant, price,
        original_price: price < 12000 ? 12000 : null,
        discount_percent: price < 12000 ? 10 : 0,
        sale_start_date: start, sale_end_date: end,
      } as typeof variant]);
      const quote = await new OrderService(prisma).createOrder(customer.id, {
        ...dto, items: [{ variantId: variant.id, quantity: 3 }],
      }, true);
      expect(quote).toMatchObject({
        subtotalAmount: expectedPrice * 3,
        totalAmount: expectedPrice * 3 + 15000,
      });
      expect(tx.orders.create).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('chooses the facility covering more items before the nearer facility', async () => {
    const { prisma } = createMocks(1);
    const secondVariant = { ...variant, id: 12, medicine_id: 22 };
    const thirdVariant = { ...variant, id: 13, medicine_id: 23 };
    prisma.packaging_variants.findMany.mockResolvedValue([variant, secondVariant, thirdVariant]);
    const stock = (variantId: number) => ({ variant_id: variantId, stock_quantity: 5, reserved_quantity: 0 });
    prisma.facilities.findMany.mockResolvedValue([
      { ...facility, id: 3, latitude: 10.77, longitude: 106.70, inventories: [stock(11)] },
      { ...facility, id: 4, latitude: 10.8, longitude: 106.8, inventories: [stock(12), stock(13)] },
    ]);
    const quote = await new OrderService(prisma).createOrder(customer.id, {
      ...dto, latitude: 10.77, longitude: 106.70,
      items: [11, 12, 13].map(variantId => ({ variantId, quantity: 1 })),
    }, true);

    expect(quote).toMatchObject({ facilityId: 4, isConsolidated: true });
  });

  it('rejects a changed quote before creating the order or reserving stock', async () => {
    const { prisma, tx } = createMocks(1);
    await expect(new OrderService(prisma).createOrder(customer.id, { ...dto, expectedTotalAmount: 1, expectedShippingFee: 30000, expectedFacilityId: 3 }))
      .rejects.toThrow(/quote has changed/i);
    expect(tx.orders.create).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('rejects a changed fulfillment plan before creating the order', async () => {
    const { prisma, tx } = createMocks(1);
    const service = new OrderService(prisma);
    const quote = await service.createOrder(customer.id, dto, true);
    if (!("planHash" in quote)) throw new Error("Expected quote");
    prisma.facilities.findMany.mockResolvedValue([{ ...facility, latitude: 11.77, longitude: 106.70 }]);
    await expect(service.createOrder(customer.id, { ...dto, latitude: 10.77, longitude: 106.70, expectedPlanHash: quote.planHash }))
      .rejects.toThrow(/quote has changed/i);
    expect(tx.orders.create).not.toHaveBeenCalled();
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
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
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

  it("uses a facility with all items instead of a nearer facility without stock", async () => {
    const { prisma, tx } = createMocks(1);
    prisma.facilities.findMany.mockResolvedValue([
      { ...facility, id: 20, latitude: 21.0, longitude: 105.8 },
      { ...facility, id: 10, latitude: 10.77, longitude: 106.70, inventories: [] },
    ]);
    tx.medicine_boxes.findMany.mockResolvedValue([]);
    const service = new OrderService(prisma);

    await service.createOrder(customer.id, { ...dto, latitude: 10.775, longitude: 106.705 });

    expect(tx.orders.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ export_facility_id: 20, order_status: 'PENDING' }),
    });
    expect(tx.internal_transfers.create).not.toHaveBeenCalled();
    expect(tx.order_items.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ source_facility_id: 20, assigned_uids: [], inventory_reserved: true })],
    });
  });

  it("chooses the nearest facility among those that can fulfill the whole order", async () => {
    const { prisma, tx } = createMocks(1);
    prisma.facilities.findMany.mockResolvedValue([
      { ...facility, id: 30, latitude: 21.0, longitude: 105.8 },
      { ...facility, id: 20, latitude: 10.78, longitude: 106.70 },
      { ...facility, id: 10, latitude: 10.775, longitude: 106.705, inventories: [] },
    ]);
    tx.medicine_boxes.findMany.mockResolvedValue([]);
    await new OrderService(prisma).createOrder(customer.id, { ...dto, latitude: 10.775, longitude: 106.705 });
    expect(tx.orders.create).toHaveBeenCalledWith({ data: expect.objectContaining({ export_facility_id: 20, order_status: 'PENDING' }) });
    expect(tx.internal_transfers.create).not.toHaveBeenCalled();
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

    expect(tx.$executeRaw).toHaveBeenCalledTimes(4);
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
        latitude: 10.77,
        longitude: 106.70,
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
