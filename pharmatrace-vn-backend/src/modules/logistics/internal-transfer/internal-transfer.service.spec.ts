import { PrismaService } from "../../../prisma/prisma.service";
import { InternalTransferService } from "./internal-transfer.service";

describe('InternalTransferService reroute authorization', () => {
  it('blocks rerouting before accessing the database', async () => {
    const prisma = { withOrder: jest.fn() };
    const service = new InternalTransferService(prisma as unknown as PrismaService);
    await expect(service.adminRerouteTransfer(8, { newToFacilityId: 3, reason: 'Change destination' }, { type: 'employee', id: 1, role: 'SUPER_ADMIN' })).rejects.toThrow(/accepted delivery plan/i);
    expect(prisma.withOrder).not.toHaveBeenCalled();
  });
  it('rejects warehouse staff before accessing the transfer', async () => {
    const prisma = { withOrder: jest.fn() };
    const service = new InternalTransferService(prisma as unknown as PrismaService);
    await expect(service.adminRerouteTransfer(8, { newToFacilityId: 3, reason: 'Change destination' }, { type: 'employee', id: 1, role: 'WAREHOUSE_STAFF', facilityId: 2 })).rejects.toThrow(/super admin/i);
    expect(prisma.withOrder).not.toHaveBeenCalled();
  });
});

describe("InternalTransferService cancellation", () => {
  it.each([3, 4])("blocks standalone cancellation for source facility %s without database access", async (facilityId) => {
    const prisma = { withOrder: jest.fn() };
    const service = new InternalTransferService(prisma as unknown as PrismaService);
    await expect(service.cancelTransfer(8, { type: "employee", id: 1, role: "WAREHOUSE_STAFF", facilityId })).rejects.toThrow(/cancel the entire order/i);
    expect(prisma.withOrder).not.toHaveBeenCalled();
  });
});

describe("InternalTransferService receiving manifested packages", () => {
  function setup(uids: string[]) {
    const tx = {
      internal_transfers: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
      inventories: { findFirst: jest.fn().mockResolvedValue({ id: 9 }), update: jest.fn().mockResolvedValue({ stock_quantity: 5 }) },
      medicine_boxes: {
        findMany: jest.fn().mockResolvedValue(uids.map((uid) => ({ uid }))),
        updateMany: jest.fn().mockResolvedValue({ count: uids.length }),
      },
      order_items: { update: jest.fn() },
      inventory_logs: { create: jest.fn() },
      orders: { update: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValueOnce([]).mockResolvedValue([{ stock_quantity: 3 }]),
    };
    const prisma = {
      internal_transfers: {
        findFirst: jest.fn().mockResolvedValue({
          id: 8, order_id: 101, transfer_code: "ITR-1", status: "DISPATCHED",
          from_facility_id: 20, to_facility_id: 10,
          items: [{ variantId: 11, medicineId: 21, quantity: 1 }],
          orders: {
            order_code: "ORD-1", order_status: "WAITING_INTERNAL_TRANSFER",
            order_items: [{ id: 6, variant_id: 11, medicine_id: 21, quantity: 1, source_facility_id: 20, inventory_reserved: true, unit_name: "Tube", assigned_uids: uids }],
          },
        }),
        findUnique: jest.fn().mockResolvedValue({ id: 8, status: "RECEIVED" }),
      },
      $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    };
    return { tx, service: new InternalTransferService(scopedPrisma(prisma)) };
  }

  it("moves only the UIDs recorded at dispatch from transit custody", async () => {
    const { tx, service } = setup(["tube-uid"]);

    await service.adminReceiveInternalTransfer(8, { type: "employee" as const,  id: 1, role: "SUPER_ADMIN" }, { lines: [{ variantId: 11, receivedQuantity: 1 }] });

    expect(tx.medicine_boxes.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ uid: { in: ["tube-uid"] }, current_facility_id: null, status: "IN_TRANSIT" }),
      data: { current_facility_id: 10, status: "RESERVED" },
    });
    expect(tx.order_items.update).toHaveBeenCalledWith({
      where: { id: 6 }, data: { source_facility_id: 10, assigned_uids: ["tube-uid"] },
    });
    expect(tx.orders.update).toHaveBeenCalledWith({ where: { id: 101 }, data: { order_status: "PROCESSING" } });
    expect(tx.inventory_logs.create).toHaveBeenCalledWith({ data: expect.objectContaining({ transaction_type: 'TRANSFER_OUT', stock_bucket: 'IN_TRANSIT', previous_quantity: 4, new_quantity: 3 }) });
    expect(tx.inventory_logs.create).toHaveBeenCalledWith({ data: expect.objectContaining({ transaction_type: 'TRANSFER_IN', previous_quantity: 4, new_quantity: 5 }) });
  });

  it("rejects an inspection that omits a transfer line", async () => {
    const { tx, service } = setup(["tube-uid"]);

    await expect(service.adminReceiveInternalTransfer(8, { type: "employee", id: 1, role: "SUPER_ADMIN" }, { lines: [] }))
      .rejects.toThrow(/include every transfer variant/i);
    expect(tx.inventories.update).not.toHaveBeenCalled();
    expect(tx.orders.update).not.toHaveBeenCalled();
  });

  it("rejects receipt without an inspection", async () => {
    const { tx, service } = setup(["tube-uid"]);

    await expect(service.adminReceiveInternalTransfer(8, { type: "employee", id: 1, role: "SUPER_ADMIN" }))
      .rejects.toThrow(/include every transfer variant/i);
    expect(tx.inventories.update).not.toHaveBeenCalled();
  });

  it("keeps the order waiting when physical packages are not ready for receipt", async () => {
    const { tx, service } = setup([]);

    await expect(service.adminReceiveInternalTransfer(8, { type: "employee" as const,  id: 1, role: "SUPER_ADMIN" }, { lines: [{ variantId: 11, receivedQuantity: 1 }] }))
      .rejects.toThrow(/manifest is missing/i);
    expect(tx.orders.update).not.toHaveBeenCalled();
  });

  it("rejects receipt when another order claims the selected package", async () => {
    const { tx, service } = setup(["tube-uid"]);
    tx.medicine_boxes.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.adminReceiveInternalTransfer(8, { type: "employee" as const,  id: 1, role: "SUPER_ADMIN" }, { lines: [{ variantId: 11, receivedQuantity: 1 }] }))
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
    }, { lines: [] });

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
    }, { lines: [] });

    expect(tx.orders.update).toHaveBeenCalledWith({
      where: { id: 1 }, data: { order_status: "PROCESSING" },
    });
  });

  it('requires counted intake before any replacement decision', async () => {
    const prisma = { withOrder: jest.fn() };
    const service = new InternalTransferService(prisma as unknown as PrismaService);
    await expect(service.adminRejectDamagedInternalTransfer(8, { id: 1, type: 'employee', role: 'SUPER_ADMIN' }))
      .rejects.toThrow(/counted receipt inspection/i);
    expect(prisma.withOrder).not.toHaveBeenCalled();
  });
});

describe('InternalTransferService transport methods', () => {
  const actor = { id: 21, type: 'employee' as const, role: 'WAREHOUSE_STAFF', facilityId: 3 };
  const manifest = [{ variantId: 1, quantity: 1, boxUids: [] }];
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
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    return { tx, service: new InternalTransferService({ withOrder: jest.fn((_operation, run) => run(tx)) } as unknown as PrismaService) };
  }

  it('dispatches with an active source employee and no external tracking', async () => {
    const { tx, service } = setup();
    await service.adminDispatchInternalTransfer(8, { transportMode: 'INTERNAL', transportEmployeeId: 21, manifest }, actor);
    expect(tx.internal_transfers.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 8, status: 'REQUESTED' },
      data: expect.objectContaining({ transport_mode: 'INTERNAL', transport_employee_id: 21, transport_employee_name: 'Source transporter', courier_name: null, tracking_code: null }),
    }));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('requires a source manifest before dispatch', async () => {
    const { tx, service } = setup();
    await expect(service.adminDispatchInternalTransfer(8, { transportMode: 'INTERNAL', transportEmployeeId: 21, manifest: [] }, actor)).rejects.toThrow(/manifest/i);
    expect(tx.internal_transfers.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an employee from another facility', async () => {
    const { tx, service } = setup();
    await expect(service.adminDispatchInternalTransfer(8, { transportMode: 'INTERNAL', transportEmployeeId: 22, manifest }, actor)).rejects.toThrow(/source facility/);
    expect(tx.internal_transfers.updateMany).not.toHaveBeenCalled();
  });

  it('dispatches through a third party without assigning an internal driver', async () => {
    const { tx, service } = setup();
    await service.adminDispatchInternalTransfer(8, { transportMode: 'THIRD_PARTY', courierName: ' ghn ', trackingCode: ' GHN-001 ', manifest }, actor);
    expect(tx.internal_transfers.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ transport_mode: 'THIRD_PARTY', transport_employee_id: null, transport_employee_name: null, courier_name: 'GHN', tracking_code: 'GHN-001' }),
    }));
  });

  it('requires actual tracking for a third-party transfer', async () => {
    const { tx, service } = setup();
    await expect(service.adminDispatchInternalTransfer(8, { transportMode: 'THIRD_PARTY', courierName: 'GHN', manifest }, actor)).rejects.toThrow(/actual tracking/);
    expect(tx.internal_transfers.updateMany).not.toHaveBeenCalled();
  });

  it('cannot change transport details by dispatching a second time', async () => {
    const { tx, service } = setup('DISPATCHED');
    await expect(service.adminDispatchInternalTransfer(8, { transportMode: 'THIRD_PARTY', courierName: 'GHN', trackingCode: 'NEW', manifest }, actor)).rejects.toThrow(/requested transfer/);
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
