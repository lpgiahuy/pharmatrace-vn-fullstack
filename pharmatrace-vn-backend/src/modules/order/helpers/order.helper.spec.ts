import { formatOrder } from './order.helper';

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
