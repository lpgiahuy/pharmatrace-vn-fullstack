import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { WarehouseLoginDto } from './dto/warehouse-login.dto';
import * as bcrypt from 'bcryptjs';
import { normalizeRole } from '../../../common/auth-identity';

const WAREHOUSE_ROLES = new Set([
  'WAREHOUSE_STAFF',
  'WAREHOUSE_MANAGER',
  'FACTORY_WAREHOUSE_STAFF',
  'SUPER_ADMIN',
]);

@Injectable()
export class AuthWarehouseService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async loginWarehouseStaff(dto: WarehouseLoginDto) {
    const email = dto.email.trim().toLowerCase();

    const employee = await this.prisma.withAuth((tx) => tx.employees.findFirst({
      where: { email },
      include: { facilities: true },
    }), { operation: 'employee_login', identifier: email });

    if (!employee || !employee.password_hash) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (employee.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is deactivated');
    }

    const ok = await bcrypt.compare(dto.password, employee.password_hash);
    if (!ok) throw new UnauthorizedException('Invalid email or password');

    const role = normalizeRole(employee.role || '');
    if (!role || !WAREHOUSE_ROLES.has(role)) {
      throw new UnauthorizedException('This account does not have Warehouse portal access');
    }

    const token = this.jwtService.sign({
      sub: employee.id,
      id: employee.id,
      role,
      facilityId: employee.facility_id,
      type: 'employee',
    });

    return {
      user: {
        id: employee.id,
        fullName: employee.full_name,
        email: employee.email,
        role,
        jobTitle: employee.job_title,
        status: employee.status,
        facilityId: employee.facility_id,
        facility: employee.facilities
          ? { id: employee.facilities.id, name: employee.facilities.facility_name, type: employee.facilities.facility_type, address: employee.facilities.address }
          : null,
        createdAt: employee.created_at,
      },
      accessToken: token,
    };
  }
}
