import { PrismaService } from "../../prisma/prisma.service";
import { AdminOrderService } from "./admin-order.service";

describe("AdminOrderService listing", () => {
  it("does not overlap order queries on one transaction connection", async () => {
    let counting = false;
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      orders: {
        count: jest.fn(async () => {
          counting = true;
          await new Promise((resolve) => setImmediate(resolve));
          counting = false;
          return 0;
        }),
        findMany: jest.fn(() => {
          if (counting) throw new Error("query already executing");
          return Promise.resolve([]);
        }),
      },
    };
    const prisma = { $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)) };
    const service = new AdminOrderService(scopedPrisma(prisma));

    await expect(service.adminGetAllOrders({}, { type: "employee" as const,  id: 12, role: "SUPER_ADMIN" }))
      .resolves.toMatchObject({ items: [], pagination: { total: 0 } });
  });
});

describe("AdminOrderService packing", () => {
  const ownUid = "11111111-1111-4111-8111-111111111111";
  const otherUid = "22222222-2222-4222-8222-222222222222";
  const facilityStaff = { type: "employee" as const,
    id: 12,
    role: "WAREHOUSE_STAFF",
    facilityId: 3,
  };
  const order = {
    id: 1,
    order_code: "ORD-1",
    order_status: "PROCESSING",
    export_facility_id: 3,
    payment_method: "COD",
    total_amount: 100,
    shipments: null,
    order_items: [
      {
        id: 10,
        medicine_id: 5,
        medicine_name: "Medicine",
        unit_name: "Box",
        quantity: 1,
        variant_id: 7,
        inventory_reserved: true,
        assigned_uids: [ownUid],
      },
    ],
  };

  function setup(otherStatus = "RESERVED", reviewStatus?: string) {
    const boxes = [ownUid, otherUid].map((uid) => ({
      uid,
      status: uid === ownUid ? "RESERVED" : otherStatus,
      current_facility_id: 3,
      batch_id: 9,
      medicine_batches: { medicine_id: 5 },
    }));
    const tx = {
      medicine_boxes: {
        findMany: jest
          .fn()
          .mockImplementation(({ where }) =>
            boxes.filter((box) => where.uid.in.includes(box.uid)),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      inventories: {
        findUnique: jest.fn().mockResolvedValue({ stock_quantity: 2 }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      order_items: { update: jest.fn() },
      inventory_logs: { create: jest.fn() },
      batches: { findUnique: jest.fn().mockResolvedValue(null) },
      shipments: { create: jest.fn() },
      orders: { update: jest.fn() },
    };
    const prisma = {
      orders: { findFirst: jest.fn().mockResolvedValue({ ...order, prescription_review_status: reviewStatus }) },
      medicine_boxes: { findMany: tx.medicine_boxes.findMany },
      $transaction: jest.fn((run: (client: typeof tx) => Promise<void>) =>
        run(tx),
      ),
    };
    return {
      service: new AdminOrderService(scopedPrisma(prisma)),
      tx,
      prisma,
    };
  }

  it("requires physical UID confirmation instead of packing silently", async () => {
    const { service, tx } = setup();
    await expect(service.adminPackOrder(1, {}, facilityStaff)).rejects.toThrow(
      /scan|UID|confirm/i,
    );
    expect(tx.shipments.create).not.toHaveBeenCalled();
  });

  it("does not pack an order before pharmacist approval", async () => {
    const { service, tx } = setup('RESERVED', 'PENDING_APPROVAL');
    await expect(service.adminPackOrder(1, { boxUids: [ownUid] }, facilityStaff))
      .rejects.toThrow(/pharmacist approval/i);
    expect(tx.shipments.create).not.toHaveBeenCalled();
  });

  it("rejects a UID reserved for another order", async () => {
    const { service, tx } = setup();
    await expect(
      service.adminPackOrder(1, { boxUids: [otherUid] }, facilityStaff),
    ).rejects.toThrow(/reserved|order/i);
    expect(tx.shipments.create).not.toHaveBeenCalled();
  });

  it("packs the exact UID reserved for this order", async () => {
    const { service, tx } = setup();
    await service.adminPackOrder(1, { boxUids: [ownUid] }, facilityStaff);

    expect(tx.medicine_boxes.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.medicine_boxes.updateMany).toHaveBeenCalledWith({
      where: {
        uid: { in: [ownUid] },
        current_facility_id: 3,
        status: "RESERVED",
      },
      data: { status: "PACKAGED" },
    });
  });

  it("assigns a scanned package when checkout did not reserve physical UIDs", async () => {
    const { service, tx, prisma } = setup("IN_STOCK");
    prisma.orders.findFirst.mockResolvedValue({
      ...order, prescription_review_status: undefined,
      order_items: [{ ...order.order_items[0], assigned_uids: [] }],
    });

    await service.adminPackOrder(1, { boxUids: [otherUid] }, facilityStaff);

    expect(tx.order_items.update).toHaveBeenCalledWith({
      where: { id: 10 }, data: { assigned_uids: [otherUid], inventory_reserved: false },
    });
    expect(tx.shipments.create).toHaveBeenCalled();
  });

  it("claims a free replacement and releases the original reservation", async () => {
    const { service, tx } = setup("IN_STOCK");
    await service.adminPackOrder(1, { boxUids: [otherUid] }, facilityStaff);

    expect(tx.medicine_boxes.updateMany).toHaveBeenCalledWith({
      where: {
        uid: { in: [otherUid] },
        current_facility_id: 3,
        status: { in: expect.arrayContaining(["IN_STOCK", "MANUFACTURED"]) },
      },
      data: { status: "RESERVED" },
    });
    expect(tx.medicine_boxes.updateMany).toHaveBeenCalledWith({
      where: {
        uid: { in: [ownUid] },
        current_facility_id: 3,
        status: "RESERVED",
      },
      data: { status: "IN_STOCK" },
    });
    expect(tx.order_items.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { assigned_uids: [otherUid], inventory_reserved: false },
    });
  });

  it("stops packing if another worker claims the replacement first", async () => {
    const { service, tx } = setup("IN_STOCK");
    tx.medicine_boxes.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.adminPackOrder(1, { boxUids: [otherUid] }, facilityStaff),
    ).rejects.toThrow(/no longer available/i);
    expect(tx.order_items.update).not.toHaveBeenCalled();
    expect(tx.shipments.create).not.toHaveBeenCalled();
  });
});

describe("AdminOrderService facility access", () => {
  const facilityStaff = { type: "employee" as const,
    id: 21,
    role: "WAREHOUSE_STAFF",
    facilityId: 3,
  };
  const superAdmin = { type: "employee" as const,
    id: 1,
    role: "SUPER_ADMIN",
    facilityId: 1,
  };

  function setup() {
    const prisma = {
      orders: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      internal_transfers: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    return {
      prisma,
      service: new AdminOrderService(scopedPrisma(prisma)),
    };
  }

  it("scopes order lists to the staff facility", async () => {
    const { service, prisma } = setup();

    await service.adminGetAllOrders({}, facilityStaff);

    expect(prisma.orders.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { export_facility_id: 3 },
      }),
    );
    expect(prisma.orders.count).toHaveBeenCalledWith({
      where: { export_facility_id: 3 },
    });
  });

  it("allows super admin to list orders across facilities", async () => {
    const { service, prisma } = setup();

    await service.adminGetAllOrders({}, superAdmin);

    expect(prisma.orders.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it("requires a facility for non-super-admin staff", async () => {
    const { service } = setup();

    await expect(
      service.adminGetAllOrders({} as any, { type: "employee" as const,
        id: 22,
        role: "WAREHOUSE_STAFF",
      }),
    ).rejects.toThrow(/assigned to a facility/i);
  });

  it("scopes order detail to the export facility", async () => {
    const { service, prisma } = setup();

    await expect(service.adminGetOrderById(99, facilityStaff)).rejects.toThrow(
      /not found/i,
    );

    expect(prisma.orders.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 99, export_facility_id: 3 },
      }),
    );
  });


});

// Transaction mocks expose the same delegates as the production scoped transaction.
function scopedPrisma(prisma: any): any {
  return { ...prisma, withOrder: jest.fn((_operation, run) => {
    const execute = (tx: any) => {
      const client = { ...prisma, ...tx };
      for (const key of Object.keys(prisma)) {
        if (typeof prisma[key] === 'object' && tx[key]) client[key] = { ...prisma[key], ...tx[key] };
      }
      client.$queryRaw ||= jest.fn().mockResolvedValue([]);
      return run(client);
    };
    return prisma.$transaction ? prisma.$transaction(execute) : execute(prisma);
  }) };
}
