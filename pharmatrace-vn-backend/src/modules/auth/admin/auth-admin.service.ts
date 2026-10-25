import { Injectable, GoneException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminSetupDto } from './dto/admin-setup.dto';
import * as bcrypt from 'bcryptjs';
import { normalizeRole } from '../../../common/auth-identity';

function sanitizeStaff(employee: any) {
  return {
    id: employee.id,
    fullName: employee.full_name,
    email: employee.email,
    role: employee.role,
    jobTitle: employee.job_title,
    status: employee.status,
    facilityId: employee.facility_id,
    facility: employee.facilities
      ? { id: employee.facilities.id, name: employee.facilities.facility_name, type: employee.facilities.facility_type, address: employee.facilities.address }
      : null,
    createdAt: employee.created_at,
  };
}

@Injectable()
export class AuthAdminService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async loginStaff(dto: AdminLoginDto) {
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
    if (!role || role === 'CUSTOMER') throw new UnauthorizedException('Invalid employee role');

    const token = this.jwtService.sign({
      sub: employee.id,
      id: employee.id,
      role,
      facilityId: employee.facility_id,
      type: 'employee',
    });

    return { user: sanitizeStaff({ ...employee, role }), accessToken: token };
  }

  async setupInitialAdmin(_dto: AdminSetupDto) {
    throw new GoneException('Initial administrators must be provisioned through the database administration process');
  }
}
