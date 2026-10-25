import { PrismaService } from "../../prisma/prisma.service";
import { AdminOrderService } from "./admin-order.service";

describe("AdminOrderService receiving unassigned packages", () => {
  function setup(uids: string[]) {
    const tx = {
      internal_transfers: { update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
      inventories: { findFirst: jest.fn().mockResolvedValue({ id: 9 }), update: jest.fn() },
      medicine_boxes: {
        findMany: jest.fn().mockResolvedValue(uids.map((uid) => ({ uid }))),
        updateMany: jest.fn().mockResolvedValue({ count: uids.length }),
      },
      order_items: { update: jest.fn() },
      inventory_logs: { create: jest.fn() },
      orders: { update: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const prisma = {
      internal_transfers: {
        findFirst: jest.fn().mockResolvedValue({
          id: 8, order_id: 101, transfer_code: "ITR-1", status: "DISPATCHED",
          from_facility_id: 20, to_facility_id: 10,
          items: [{ variantId: 11, medicineId: 21, quantity: 1 }],
          orders: {
            order_code: "ORD-1", order_status: "WAITING_INTERNAL_TRANSFER",
            order_items: [{ id: 6, variant_id: 11, medicine_id: 21, unit_name: "Tube", assigned_uids: [] }],
          },
        }),
        findUnique: jest.fn().mockResolvedValue({ id: 8, status: "RECEIVED" }),
      },
      $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    };
    return { tx, service: new AdminOrderService(prisma as unknown as PrismaService) };
  }

  it("assigns and moves physical UIDs when checkout deferred package assignment", async () => {
    const { tx, service } = setup(["tube-uid"]);

    await service.adminReceiveInternalTransfer(8, { id: 1, role: "SUPER_ADMIN" });

    expect(tx.medicine_boxes.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ uid: { in: ["tube-uid"] }, current_facility_id: 20 }),
      data: { current_facility_id: 10, status: "RESERVED" },
    });
    expect(tx.order_items.update).toHaveBeenCalledWith({
      where: { id: 6 }, data: { source_facility_id: 10, assigned_uids: ["tube-uid"] },
    });
    expect(tx.orders.update).toHaveBeenCalledWith({ where: { id: 101 }, data: { order_status: "PROCESSING" } });
  });

  it("keeps the order waiting when physical packages are not ready for receipt", async () => {
    const { tx, service } = setup([]);

    await expect(service.adminReceiveInternalTransfer(8, { id: 1, role: "SUPER_ADMIN" }))
      .rejects.toThrow(/physical package/i);
    expect(tx.orders.update).not.toHaveBeenCalled();
  });

  it("rejects receipt when another order claims the selected package", async () => {
    const { tx, service } = setup(["tube-uid"]);
    tx.medicine_boxes.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.adminReceiveInternalTransfer(8, { id: 1, role: "SUPER_ADMIN" }))
      .rejects.toThrow(/availability changed/i);
    expect(tx.order_items.update).not.toHaveBeenCalled();
    expect(tx.orders.update).not.toHaveBeenCalled();
  });
});

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
    const service = new AdminOrderService(prisma as unknown as PrismaService);

    await expect(service.adminGetAllOrders({}, { id: 12, role: "SUPER_ADMIN" }))
      .resolves.toMatchObject({ items: [], pagination: { total: 0 } });
  });
});

describe("AdminOrderService packing", () => {
  const ownUid = "11111111-1111-4111-8111-111111111111";
  const otherUid = "22222222-2222-4222-8222-222222222222";
  const facilityStaff = {
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
      service: new AdminOrderService(prisma as unknown as PrismaService),
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
  const facilityStaff = {
    id: 21,
    role: "WAREHOUSE_STAFF",
    facilityId: 3,
  };
  const superAdmin = {
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
      service: new AdminOrderService(prisma as unknown as PrismaService),
    };
  }

  it("scopes order lists to the staff facility", async () => {
    const { service, prisma } = setup();

    await service.adminGetAllOrders({} as any, facilityStaff);

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

    await service.adminGetAllOrders({} as any, superAdmin);

    expect(prisma.orders.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it("requires a facility for non-super-admin staff", async () => {
    const { service } = setup();

    await expect(
      service.adminGetAllOrders({} as any, {
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

  it("shows only transfers involving the staff facility", async () => {
    const { service, prisma } = setup();

    await service.adminGetInternalTransfers(undefined, facilityStaff);

    expect(prisma.internal_transfers.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ from_facility_id: 3 }, { to_facility_id: 3 }],
        },
      }),
    );
  });

  it("allows dispatch lookup only at the source facility", async () => {
    const { service, prisma } = setup();

    await expect(
      service.adminDispatchInternalTransfer(8, undefined, facilityStaff),
    ).rejects.toThrow(/not found/i);

    expect(prisma.internal_transfers.findFirst).toHaveBeenCalledWith({
      where: { id: 8, from_facility_id: 3 },
    });
  });

  it("allows receive lookup only at the destination facility", async () => {
    const { service, prisma } = setup();

    await expect(
      service.adminReceiveInternalTransfer(8, facilityStaff),
    ).rejects.toThrow(/not found/i);

    expect(prisma.internal_transfers.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 8, to_facility_id: 3 },
      }),
    );
  });
});

describe("AdminOrderService transfer completion", () => {
  it("keeps the order waiting when another transfer was cancelled", async () => {
    const tx = {
      internal_transfers: {
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
      orders: { update: jest.fn() },
    };
    const prisma = {
      internal_transfers: {
        findFirst: jest.fn().mockResolvedValue({
          id: 8,
          order_id: 1,
          status: "DISPATCHED",
          items: [],
          orders: { order_items: [], internal_transfers: [], order_code: "ORD-1" },
        }),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((run: (client: typeof tx) => Promise<void>) => run(tx)),
    };
    const service = new AdminOrderService(prisma as unknown as PrismaService);

    await service.adminReceiveInternalTransfer(8, {
      id: 1, role: "SUPER_ADMIN", facilityId: 1,
    });

    expect(tx.internal_transfers.count).toHaveBeenCalledWith({
      where: {
        order_id: 1,
        id: { not: 8 },
        status: { notIn: ["RECEIVED", "REPLACED"] },
      },
    });
    expect(tx.orders.update).not.toHaveBeenCalled();
  });

  it("starts processing after the replacement is received", async () => {
    const tx = {
      internal_transfers: {
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      orders: { update: jest.fn() },
    };
    const prisma = {
      internal_transfers: {
        findFirst: jest.fn().mockResolvedValue({
          id: 9,
          order_id: 1,
          status: "DISPATCHED",
          items: [],
          orders: { order_items: [], internal_transfers: [], order_code: "ORD-1" },
        }),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((run: (client: typeof tx) => Promise<void>) => run(tx)),
    };
    const service = new AdminOrderService(prisma as unknown as PrismaService);

    await service.adminReceiveInternalTransfer(9, {
      id: 1, role: "SUPER_ADMIN", facilityId: 1,
    });

    expect(tx.orders.update).toHaveBeenCalledWith({
      where: { id: 1 }, data: { order_status: "PROCESSING" },
    });
  });

  it("quarantines damaged boxes and reserves different boxes for a replacement transfer", async () => {
    const damagedUid = "11111111-1111-4111-8111-111111111111";
    const replacementUid = "22222222-2222-4222-8222-222222222222";
    const tx = {
      internal_transfers: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 9, status: "REQUESTED" }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      inventory_logs: { create: jest.fn() },
      medicine_boxes: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ uid: replacementUid }]),
      },
      order_items: { update: jest.fn(), updateMany: jest.fn() },
    };
    const prisma = {
      internal_transfers: {
        findFirst: jest.fn().mockResolvedValue({
          id: 8,
          order_id: 1,
          transfer_code: "ITR-OLD",
          from_facility_id: 2,
          to_facility_id: 3,
          status: "DISPATCHED",
          items: [{ variantId: 7, medicineId: 5, quantity: 1 }],
          orders: {
            order_code: "ORD-1",
            order_status: "WAITING_INTERNAL_TRANSFER",
            order_items: [{
              id: 10, variant_id: 7, unit_name: "Box", assigned_uids: [damagedUid],
            }],
          },
        }),
      },
      $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    };
    const service = new AdminOrderService(prisma as unknown as PrismaService);

    await service.adminRejectDamagedInternalTransfer(8, {
      id: 1, role: "SUPER_ADMIN", facilityId: 1,
    });

    expect(tx.internal_transfers.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 8, status: "DISPATCHED" },
      data: expect.objectContaining({ status: "REJECTED_UNFULFILLED" }),
    }));
    expect(tx.internal_transfers.update).toHaveBeenCalledWith({
      where: { id: 8 }, data: { status: "REPLACED" },
    });
    expect(tx.medicine_boxes.updateMany).toHaveBeenCalledWith({
      where: { uid: { in: [damagedUid] }, current_facility_id: 2, status: "RESERVED" },
      data: { status: "DAMAGED" },
    });
    expect(tx.order_items.update).toHaveBeenCalledWith({
      where: { id: 10 }, data: { assigned_uids: [replacementUid], inventory_reserved: true },
    });
    expect(tx.internal_transfers.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ order_id: 1, status: "REQUESTED" }),
    });
  });

  it("records damaged delivery as unfulfilled when the source has no replacement stock", async () => {
    const tx = {
      internal_transfers: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: 8, status: "REJECTED_UNFULFILLED" }),
        create: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
      inventory_logs: { create: jest.fn() },
      medicine_boxes: { updateMany: jest.fn() },
      order_items: { updateMany: jest.fn() },
    };
    const prisma = {
      internal_transfers: {
        findFirst: jest.fn().mockResolvedValue({
          id: 8,
          order_id: 1,
          transfer_code: "ITR-OLD",
          from_facility_id: 2,
          to_facility_id: 3,
          status: "DISPATCHED",
          items: [{ variantId: 7, medicineId: 5, quantity: 1 }],
          orders: {
            order_code: "ORD-1",
            order_status: "WAITING_INTERNAL_TRANSFER",
            order_items: [{ id: 10, variant_id: 7, unit_name: "kg", assigned_uids: [] }],
          },
        }),
      },
      $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    };
    const service = new AdminOrderService(prisma as unknown as PrismaService);

    await expect(service.adminRejectDamagedInternalTransfer(8, {
      id: 1, role: "SUPER_ADMIN", facilityId: 1,
    })).resolves.toEqual({ id: 8, status: "REJECTED_UNFULFILLED" });
    expect(tx.internal_transfers.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: expect.objectContaining({
        status: "REJECTED_UNFULFILLED",
        notes: expect.stringMatching(/insufficient replacement stock/i),
      }),
    });
    expect(tx.internal_transfers.create).not.toHaveBeenCalled();
  });

  it("releases earlier replacement reservations when a later item cannot be fulfilled", async () => {
    const tx = {
      internal_transfers: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: 8, status: "REJECTED_UNFULFILLED" }),
        create: jest.fn(),
      },
      $executeRaw: jest.fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1),
      inventory_logs: { create: jest.fn() },
      medicine_boxes: { updateMany: jest.fn() },
      order_items: { updateMany: jest.fn() },
    };
    const prisma = {
      internal_transfers: {
        findFirst: jest.fn().mockResolvedValue({
          id: 8,
          order_id: 1,
          transfer_code: "ITR-OLD",
          from_facility_id: 2,
          to_facility_id: 3,
          status: "DISPATCHED",
          items: [
            { variantId: 7, medicineId: 5, quantity: 1 },
            { variantId: 8, medicineId: 6, quantity: 1 },
          ],
          orders: {
            order_code: "ORD-1",
            order_status: "WAITING_INTERNAL_TRANSFER",
            order_items: [
              { id: 10, variant_id: 7, unit_name: "kg", assigned_uids: [] },
              { id: 11, variant_id: 8, unit_name: "kg", assigned_uids: [] },
            ],
          },
        }),
      },
      $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    };
    const service = new AdminOrderService(prisma as unknown as PrismaService);

    await expect(service.adminRejectDamagedInternalTransfer(8, {
      id: 1, role: "SUPER_ADMIN", facilityId: 1,
    })).resolves.toEqual({ id: 8, status: "REJECTED_UNFULFILLED" });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(5);
    expect(tx.order_items.updateMany).toHaveBeenCalledWith({
      where: { order_id: 1, variant_id: { in: [7, 8] } },
      data: { assigned_uids: [], inventory_reserved: false },
    });
    expect(tx.internal_transfers.create).not.toHaveBeenCalled();
  });
});
