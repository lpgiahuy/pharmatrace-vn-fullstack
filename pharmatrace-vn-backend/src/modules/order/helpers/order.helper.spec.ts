import { formatOrder, releaseOrderReservations } from './order.helper';

describe('releaseOrderReservations', () => {
  it('does not release inventory while an internal transfer is in transit, transitioning transfer to RETURN_REQUESTED', async () => {
    const tx = {
      internal_transfers: {
        findMany: jest.fn().mockResolvedValue([{ id: 1, status: 'DISPATCHED', from_facility_id: 3 }]),
        update: jest.fn().mockResolvedValue({ id: 1 }),
        updateMany: jest.fn(),
      },
      order_items: { findMany: jest.fn().mockResolvedValue([{ id: 10, variant_id: 5, quantity: 2, source_facility_id: 3, assigned_uids: [] }]) },
      $executeRaw: jest.fn(),
    };
    await releaseOrderReservations(tx as never, 7, 3);
    expect(tx.internal_transfers.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ status: 'RETURN_REQUESTED' }),
      }),
    );
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('releases inventory and cancels transfer when transfer is pre-dispatch (REQUESTED)', async () => {
    const tx = {
      internal_transfers: {
        findMany: jest.fn().mockResolvedValue([{ id: 2, status: 'REQUESTED', from_facility_id: 3 }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      order_items: {
        findMany: jest.fn().mockResolvedValue([{ id: 10, variant_id: 5, quantity: 2, source_facility_id: 3, assigned_uids: [] }]),
        update: jest.fn().mockResolvedValue({ id: 10 }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    await releaseOrderReservations(tx as never, 7, 3);
    expect(tx.internal_transfers.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [2] } },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.order_items.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 10 },
        data: expect.objectContaining({ inventory_reserved: false }),
      }),
    );
  });
});

describe('formatOrder prescription privacy', () => {
  it('does not expose a prescription image in general order responses', () => {
    const result = formatOrder({
      id: 1,
      prescription_id: 9,
      prescription_review_status: 'PENDING_APPROVAL',
      prescriptions: { prescription_image_url: 'private-image.jpg', diagnosis: 'private' },
      order_items: [],
    });

    expect(result.prescriptionId).toBe(9);
    expect(result.prescriptionReviewStatus).toBe('PENDING_APPROVAL');
    expect(JSON.stringify(result)).not.toContain('private-image.jpg');
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
