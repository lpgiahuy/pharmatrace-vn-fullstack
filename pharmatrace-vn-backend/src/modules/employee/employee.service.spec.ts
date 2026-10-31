import { BadRequestException } from '@nestjs/common';
import { EmployeeService } from './employee.service';

describe('Employee facility assignment', () => {
  const service = new EmployeeService({} as any);
  it.each(['MANUFACTURER', 'LEGACY_EXTERNAL'])('rejects a new employee assigned to %s', async (facilityType) => {
    const tx = { employees: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      facilities: { findUnique: jest.fn().mockResolvedValue({ id: 2, facility_type: facilityType }) } };
    await expect((service as any).createInTransaction(tx, { email: 'staff@example.test', facilityId: 2 }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(tx.employees.create).not.toHaveBeenCalled();
  });
  it('rejects changing an employee to an external manufacturer', async () => {
    const tx = { employees: { findUnique: jest.fn().mockResolvedValue({ id: 1, facility_id: 1 }), update: jest.fn() },
      facilities: { findUnique: jest.fn().mockResolvedValue({ id: 2, facility_type: 'LEGACY_EXTERNAL' }) } };
    await expect((service as any).updateInTransaction(tx, 1, { facilityId: 2 })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.employees.update).not.toHaveBeenCalled();
  });
});
