import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from './guards/roles.guard';
import { CustomerController } from '../modules/customer/customer.controller';
import { VoucherController } from '../modules/voucher/voucher.controller';
import { CreateEmployeeDto } from '../modules/employee/dto/create-employee.dto';
import { UpdateEmployeeDto } from '../modules/employee/dto/update-employee.dto';

describe('Pharmacist permissions', () => {
  it.each(['PHARMACIST', 'Pharmacist'])('accepts and stores canonical pharmacist role for %s', async (role) => {
    const dto = plainToInstance(CreateEmployeeDto, {
      email: 'pharmacist@example.test', password: 'TestOnly123!', fullName: 'Test Pharmacist', facilityId: 1, role,
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.role).toBe('PHARMACIST');
    const update = plainToInstance(UpdateEmployeeDto, { role });
    expect(await validate(update)).toHaveLength(0);
    expect(update.role).toBe('PHARMACIST');
  });

  it.each(['UNKNOWN_ROLE', 'CUSTOMER'])('rejects employee writes with %s', async (role) => {
    for (const dto of [plainToInstance(CreateEmployeeDto, { role }), plainToInstance(UpdateEmployeeDto, { role })]) {
      expect((await validate(dto)).some(error => error.property === 'role')).toBe(true);
    }
  });

  it.each([
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Inspect handler metadata without invoking the method.
    [CustomerController, CustomerController.prototype.findAll],
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Inspect handler metadata without invoking the method.
    [VoucherController, VoucherController.prototype.findAll],
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Inspect handler metadata without invoking the method.
    [VoucherController, VoucherController.prototype.findOne],
  ])('grants pharmacists customer and voucher access through %p', (controller, handler) => {
    const user = { id: 1, type: 'employee', role: 'PHARMACIST' };
    const context = {
      getClass: () => controller, getHandler: () => handler,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
    const guard = new RolesGuard(new Reflector());
    expect(guard.canActivate(context)).toBe(true);
    user.role = 'WAREHOUSE_STAFF';
    expect(guard.canActivate(context)).toBe(false);
    user.role = 'UNKNOWN_ROLE';
    expect(guard.canActivate(context)).toBe(false);
  });
});
