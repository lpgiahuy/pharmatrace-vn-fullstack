import { ProductService } from './product.service';

describe('ProductService.delete', () => {
  const user = { id: 1, type: 'employee' as const, role: 'STORE_MANAGER', facilityId: 1 };
  const tx = {
    batches: { count: jest.fn() },
    medicines: { update: jest.fn(), delete: jest.fn() },
  };
  const orderTx = { $queryRaw: jest.fn() };
  const prisma = {
    withCatalogManagement: jest.fn((_actor, callback) => callback(tx)),
    withOrder: jest.fn((_operation, callback) => callback(orderTx)),
  };
  const cloudinary = { deleteImage: jest.fn() };
  const service = new ProductService(prisma as any, cloudinary as any);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(service, 'findOne').mockResolvedValue({ medicineName: 'Test', imageUrl: null } as any);
    tx.batches.count.mockResolvedValue(0);
    orderTx.$queryRaw.mockResolvedValue([{ present: false }]);
  });

  it('keeps medicines with order history inactive', async () => {
    orderTx.$queryRaw.mockResolvedValue([{ present: true }]);
    expect((await service.delete(7, user)).isSoftDeleted).toBe(true);
    expect(tx.medicines.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { status: 'INACTIVE' } });
    expect(tx.medicines.delete).not.toHaveBeenCalled();
  });

  it('keeps medicines with batches and deletes medicines without history', async () => {
    tx.batches.count.mockResolvedValueOnce(1);
    expect((await service.delete(7, user)).isSoftDeleted).toBe(true);
    expect((await service.delete(7, user)).isSoftDeleted).toBe(false);
    expect(tx.medicines.delete).toHaveBeenCalledTimes(1);
  });
});
