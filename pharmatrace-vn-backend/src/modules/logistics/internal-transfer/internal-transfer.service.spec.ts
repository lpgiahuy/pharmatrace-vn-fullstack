import { PrismaService } from "../../../prisma/prisma.service";
import { InternalTransferService } from "./internal-transfer.service";

describe("InternalTransferService cancellation", () => {
  it("rejects cancellation at a different source facility", async () => {
    const tx = { internal_transfers: { findFirst: jest.fn().mockResolvedValue({ id: 8, status: "REQUESTED", from_facility_id: 4 }) }, $queryRaw: jest.fn() };
    const prisma = { withOrder: jest.fn((_operation, run) => run(tx)) };
    const service = new InternalTransferService(prisma as unknown as PrismaService);
    await expect(service.cancelTransfer(8, { type: "employee", id: 1, role: "WAREHOUSE_STAFF", facilityId: 3 })).rejects.toThrow(/not found/i);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("cancels a requested transfer through the scoped transaction", async () => {
    const tx = { internal_transfers: { findFirst: jest.fn().mockResolvedValue({ id: 8, status: "REQUESTED", from_facility_id: 3 }) }, $queryRaw: jest.fn().mockResolvedValue([{ cancelled: true }]) };
    const prisma = { withOrder: jest.fn((_operation, run) => run(tx)) };
    const service = new InternalTransferService(prisma as unknown as PrismaService);
    await expect(service.cancelTransfer(8, { type: "employee", id: 1, role: "WAREHOUSE_STAFF", facilityId: 3 })).resolves.toEqual({ id: 8, status: "CANCELLED", orderActionRequired: true });
    expect(prisma.withOrder).toHaveBeenCalledWith('dispatch', expect.any(Function), expect.objectContaining({ id: 1 }));
  });
});

describe("InternalTransferService receiving unassigned packages", () => {
  function setup(uids: string[]) {
    const tx = {
      internal_transfers: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
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
            order_items: [{ id: 6, variant_id: 11, medicine_id: 21, quantity: 1, source_facility_id: 20, inventory_reserved: true, unit_name: "Tube", assigned_uids: [] }],
          },
        }),
        findUnique: jest.fn().mockResolvedValue({ id: 8, status: "RECEIVED" }),
      },
      $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    };
    return { tx, service: new InternalTransferService(scopedPrisma(prisma)) };
  }

  it("assigns and moves physical UIDs when checkout deferred package assignment", async () => {
    const { tx, service } = setup(["tube-uid"]);

    await service.adminReceiveInternalTransfer(8, { type: "employee" as const,  id: 1, role: "SUPER_ADMIN" });

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

    await expect(service.adminReceiveInternalTransfer(8, { type: "employee" as const,  id: 1, role: "SUPER_ADMIN" }))
      .rejects.toThrow(/physical package/i);
    expect(tx.orders.update).not.toHaveBeenCalled();
  });

  it("rejects receipt when another order claims the selected package", async () => {
    const { tx, service } = setup(["tube-uid"]);
    tx.medicine_boxes.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.adminReceiveInternalTransfer(8, { type: "employee" as const,  id: 1, role: "SUPER_ADMIN" }))
      .rejects.toThrow(/availability changed/i);
    expect(tx.order_items.update).not.toHaveBeenCalled();
    expect(tx.orders.update).not.toHaveBeenCalled();
  });
});

describe("InternalTransferService facility access", () => {
  const facilityStaff = { type: "employee" as const, id: 21, role: "WAREHOUSE_STAFF", facilityId: 3 };
  function setup() {
    const prisma = { internal_transfers: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) } };
    return { prisma, service: new InternalTransferService(scopedPrisma(prisma)) };
  }
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

describe("InternalTransferService transfer completion", () => {
  it("keeps the order waiting when another transfer was cancelled", async () => {
    const tx = {
      internal_transfers: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn(),
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
          orders: { order_status: "WAITING_INTERNAL_TRANSFER", order_items: [], internal_transfers: [], order_code: "ORD-1" },
        }),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((run: (client: typeof tx) => Promise<void>) => run(tx)),
    };
    const service = new InternalTransferService(scopedPrisma(prisma));

    await service.adminReceiveInternalTransfer(8, { type: "employee" as const,
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
      internal_transfers: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn(),
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
          orders: { order_status: "WAITING_INTERNAL_TRANSFER", order_items: [], internal_transfers: [], order_code: "ORD-1" },
        }),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((run: (client: typeof tx) => Promise<void>) => run(tx)),
    };
    const service = new InternalTransferService(scopedPrisma(prisma));

    await service.adminReceiveInternalTransfer(9, { type: "employee" as const,
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
    const service = new InternalTransferService(scopedPrisma(prisma));

    await service.adminRejectDamagedInternalTransfer(8, { type: "employee" as const,
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
    const service = new InternalTransferService(scopedPrisma(prisma));

    await expect(service.adminRejectDamagedInternalTransfer(8, { type: "employee" as const,
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
    const service = new InternalTransferService(scopedPrisma(prisma));

    await expect(service.adminRejectDamagedInternalTransfer(8, { type: "employee" as const,
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

describe('InternalTransferService transport methods', () => {
  const actor = { id: 21, type: 'employee' as const, role: 'WAREHOUSE_STAFF', facilityId: 3 };
  function setup(status = 'REQUESTED') {
    const tx = {
      internal_transfers: {
        findFirst: jest.fn().mockResolvedValue({ id: 8, order_id: 101, from_facility_id: 3, to_facility_id: 4, status }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: jest.fn().mockImplementation((parts: TemplateStringsArray) => Promise.resolve(
        parts.join('').includes('transfer_transport_staff') ? [{ id: 21, full_name: 'Source transporter' }]
          : [{ order_status: 'WAITING_INTERNAL_TRANSFER', prescription_review_status: 'APPROVED' }],
      )),
    };
    return { tx, service: new InternalTransferService({ withOrder: jest.fn((_operation, run) => run(tx)) } as unknown as PrismaService) };
  }

  it('dispatches with an active source employee and no external tracking', async () => {
    const { tx, service } = setup();
    await service.adminDispatchInternalTransfer(8, { transportMode: 'INTERNAL', transportEmployeeId: 21 }, actor);
    expect(tx.internal_transfers.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 8, status: 'REQUESTED' },
      data: expect.objectContaining({ transport_mode: 'INTERNAL', transport_employee_id: 21, transport_employee_name: 'Source transporter', courier_name: null, tracking_code: null }),
    }));
  });

  it('rejects an employee from another facility', async () => {
    const { tx, service } = setup();
    await expect(service.adminDispatchInternalTransfer(8, { transportMode: 'INTERNAL', transportEmployeeId: 22 }, actor)).rejects.toThrow(/source facility/);
    expect(tx.internal_transfers.updateMany).not.toHaveBeenCalled();
  });

  it('dispatches through a third party without assigning an internal driver', async () => {
    const { tx, service } = setup();
    await service.adminDispatchInternalTransfer(8, { transportMode: 'THIRD_PARTY', courierName: ' ghn ', trackingCode: ' GHN-001 ' }, actor);
    expect(tx.internal_transfers.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ transport_mode: 'THIRD_PARTY', transport_employee_id: null, transport_employee_name: null, courier_name: 'GHN', tracking_code: 'GHN-001' }),
    }));
  });

  it('requires actual tracking for a third-party transfer', async () => {
    const { tx, service } = setup();
    await expect(service.adminDispatchInternalTransfer(8, { transportMode: 'THIRD_PARTY', courierName: 'GHN' }, actor)).rejects.toThrow(/actual tracking/);
    expect(tx.internal_transfers.updateMany).not.toHaveBeenCalled();
  });

  it('cannot change transport details by dispatching a second time', async () => {
    const { tx, service } = setup('DISPATCHED');
    await expect(service.adminDispatchInternalTransfer(8, { transportMode: 'THIRD_PARTY', courierName: 'GHN', trackingCode: 'NEW' }, actor)).rejects.toThrow(/requested transfer/);
    expect(tx.internal_transfers.updateMany).not.toHaveBeenCalled();
  });

  it('explains destination-only receipt to staff who can see the source transfer', async () => {
    const { tx, service } = setup('DISPATCHED');
    tx.internal_transfers.findFirst.mockResolvedValueOnce(null);
    await expect(service.adminReceiveInternalTransfer(8, actor)).rejects.toThrow(/destination facility/);
    expect(tx.internal_transfers.updateMany).not.toHaveBeenCalled();
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
