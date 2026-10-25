import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { PrescriptionService } from './prescription.service';

describe('PrescriptionService review boundaries', () => {
  const pharmacist = { id: 8, role: 'PHARMACIST', type: 'employee', facilityId: 1 };
  const cloudinary = {
    uploadPrivateImage: jest.fn(),
    deletePrivateImage: jest.fn(),
    downloadPrivateImage: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('compresses uploads to WebP before private Cloudinary storage', async () => {
    const input = await sharp({
      create: { width: 2400, height: 1600, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).jpeg().toBuffer();
    const tx = {
      prescriptions: {
        create: jest.fn().mockResolvedValue({ id: 9, created_at: new Date('2026-10-20T00:00:00.000Z') }),
      },
    };
    const prisma = { withActor: jest.fn((_actor, run) => run(tx)) };
    cloudinary.uploadPrivateImage.mockResolvedValue({ publicId: 'pharmatrace/prescriptions/abc', bytes: 1200, width: 2200, height: 1467 });
    const service = new PrescriptionService(prisma as unknown as PrismaService, cloudinary as unknown as CloudinaryService);

    await service.uploadPrescription(1, { buffer: input, mimetype: 'image/jpeg', size: input.length });

    const [compressed, folder] = cloudinary.uploadPrivateImage.mock.calls[0];
    expect(folder).toBe('pharmatrace/prescriptions');
    expect(compressed.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(compressed.subarray(8, 12).toString('ascii')).toBe('WEBP');
    expect(tx.prescriptions.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ prescription_image_url: 'cloudinary:pharmatrace/prescriptions/abc' }),
    }));
  });

  it('rejects non-pharmacist staff before reading review data', async () => {
    const prisma = { withActor: jest.fn() };
    const service = new PrescriptionService(prisma as unknown as PrismaService, cloudinary as unknown as CloudinaryService);

    await expect(service.getReviewQueue({ ...pharmacist, role: 'WAREHOUSE_STAFF' }, 'PENDING_APPROVAL', 1, 20))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.withActor).not.toHaveBeenCalled();
  });

  it('scopes the queue to the preparing facility', async () => {
    const tx = {
      order_prescription_reviews: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const prisma = { withActor: jest.fn((actor, run) => run(tx)) };
    const service = new PrescriptionService(prisma as unknown as PrismaService, cloudinary as unknown as CloudinaryService);

    await service.getReviewQueue(pharmacist, 'PENDING_APPROVAL', 1, 20);

    expect(tx.order_prescription_reviews.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'PENDING_APPROVAL', order: { export_facility_id: 1, order_status: { not: 'CANCELLED' } } },
    }));
  });

  it('does not overlap review queries on one transaction connection', async () => {
    let loading = false;
    const tx = {
      order_prescription_reviews: {
        findMany: jest.fn(async () => {
          loading = true;
          await new Promise((resolve) => setImmediate(resolve));
          loading = false;
          return [];
        }),
        count: jest.fn(() => {
          if (loading) throw new Error('query already executing');
          return Promise.resolve(0);
        }),
      },
    };
    const prisma = { withActor: jest.fn((_actor, run) => run(tx)) };
    const service = new PrescriptionService(prisma as unknown as PrismaService, cloudinary as unknown as CloudinaryService);

    await expect(service.getReviewQueue(pharmacist, 'PENDING_APPROVAL')).resolves.toMatchObject({
      items: [], pagination: { total: 0 },
    });
  });

  it('cannot approve a review belonging to a different facility', async () => {
    const tx = { order_prescription_reviews: { findFirst: jest.fn().mockResolvedValue(null) } };
    const prisma = { withActor: jest.fn((actor, run) => run(tx)) };
    const service = new PrescriptionService(prisma as unknown as PrismaService, cloudinary as unknown as CloudinaryService);

    await expect(service.decidePrescriptionReview(pharmacist, 42, 'APPROVED')).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.order_prescription_reviews.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 42, order: { export_facility_id: 1 } },
    }));
  });

  it('does not record a second decision after a concurrent review', async () => {
    const tx = {
      order_prescription_reviews: {
        findFirst: jest.fn().mockResolvedValue({
          id: 5,
          status: 'PENDING_APPROVAL',
          order_id: 10,
          facility_id: 1,
          order: { order_status: 'PENDING' },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      orders: { update: jest.fn() },
    };
    const prisma = { withActor: jest.fn((actor, run) => run(tx)) };
    const service = new PrescriptionService(prisma as unknown as PrismaService, cloudinary as unknown as CloudinaryService);

    await expect(service.decidePrescriptionReview(pharmacist, 5, 'APPROVED')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.orders.update).not.toHaveBeenCalled();
  });

  it('approves a pending legacy review when the order review status is null', async () => {
    const tx = {
      order_prescription_reviews: {
        findFirst: jest.fn().mockResolvedValue({
          id: 5,
          status: 'PENDING_APPROVAL',
          order_id: 140,
          facility_id: 1,
          order: { order_status: 'PENDING', prescription_review_status: null, export_facility_id: 1 },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orders: {
        updateMany: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve({ count: where.prescription_review_status === null ? 1 : 0 }),
        ),
      },
    };
    const prisma = { withActor: jest.fn((_actor, run) => run(tx)) };
    const service = new PrescriptionService(prisma as unknown as PrismaService, cloudinary as unknown as CloudinaryService);

    await expect(service.decidePrescriptionReview(pharmacist, 5, 'APPROVED'))
      .resolves.toEqual({ id: 5, orderId: 140, status: 'APPROVED' });
    expect(tx.orders.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ prescription_review_status: null }),
    }));
  });

  it('requires a reason before rejecting an order', async () => {
    const prisma = { withActor: jest.fn() };
    const service = new PrescriptionService(prisma as unknown as PrismaService, cloudinary as unknown as CloudinaryService);

    await expect(service.decidePrescriptionReview(pharmacist, 5, 'REJECTED', '  ')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.withActor).not.toHaveBeenCalled();
  });
});
