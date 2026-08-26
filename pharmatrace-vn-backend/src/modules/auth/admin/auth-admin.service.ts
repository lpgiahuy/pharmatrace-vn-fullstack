import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminSetupDto } from './dto/admin-setup.dto';
import * as bcrypt from 'bcryptjs';

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

    const employee = await this.prisma.employees.findFirst({
      where: { email },
      include: { facilities: true },
    });

    if (!employee || !employee.password_hash) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (employee.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is deactivated');
    }

    const ok = await bcrypt.compare(dto.password, employee.password_hash);
    if (!ok) throw new UnauthorizedException('Invalid email or password');

    const token = this.jwtService.sign({
      sub: employee.id,
      id: employee.id,
      role: employee.role,
      facilityId: employee.facility_id,
      type: 'employee',
    });

    return { user: sanitizeStaff(employee), accessToken: token };
  }

  async setupInitialAdmin(dto: AdminSetupDto) {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.prisma.employees.findFirst({ where: { email } });
    if (existing) throw new ConflictException('SuperAdmin email already exists');

    const password_hash = await bcrypt.hash(dto.password, 10);

    const newAdmin = await this.prisma.employees.create({
      data: {
        email,
        password_hash,
        full_name: dto.fullName?.trim() ?? 'System SuperAdmin',
        role: 'SUPER_ADMIN',
        job_title: 'SuperAdmin',
        status: 'ACTIVE',
        facility_id: dto.facilityId ?? 1,
      },
    });

    return {
      id: newAdmin.id,
      fullName: newAdmin.full_name,
      email: newAdmin.email,
      role: newAdmin.role,
      facilityId: newAdmin.facility_id,
    };
  }
}
