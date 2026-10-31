import { FacilityService } from './facility.service';

describe('Facility statistics', () => {
  it('counts factories separately from warehouses and pharmacies', async () => {
    const prisma = { facilities: { findMany: jest.fn().mockResolvedValue([
      { id: 1, facility_type: 'FACTORY' },
      { id: 2, facility_type: 'CENTRAL_WAREHOUSE' },
      { id: 3, facility_type: 'BRANCH_WAREHOUSE' },
      { id: 4, facility_type: 'PHARMACY' },
    ]) } };
    const service = new FacilityService(prisma as any);
    await expect(service.getStats()).resolves.toEqual({ total: 4, factories: 1, warehouses: 2, pharmacies: 1 });
  });
});
