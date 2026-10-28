import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { authActor } from '../../common/auth-identity';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeeQueryDto } from './dto/employee-query.dto';
import * as bcrypt from 'bcryptjs';

function formatEmployee(emp: any) {
  return {
    id: emp.id,
    fullName: emp.full_name || '',
    email: emp.email || '',
    role: emp.role || 'PHARMACIST',
    status: emp.status || 'ACTIVE',
    facilityId: emp.facility_id,
    facility: emp.facilities
      ? {
          id: emp.facilities.id,
          name: emp.facilities.facility_name,
          type: emp.facilities.facility_type,
          address: emp.facilities.address,
        }
      : null,
    createdAt: emp.created_at,
  };
}

@Injectable()
export class EmployeeService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: EmployeeQueryDto | undefined, user: CurrentUserPayload) {
    return this.prisma.withEmployeeManagement(authActor(user), tx => this.findAllInTransaction(tx, query));
  }

  async findOne(id: number, user: CurrentUserPayload) {
    return this.prisma.withEmployeeManagement(authActor(user), tx => this.findOneInTransaction(tx, id));
  }

  async create(dto: CreateEmployeeDto, user: CurrentUserPayload) {
    return this.prisma.withEmployeeManagement(authActor(user), tx => this.createInTransaction(tx, dto));
  }

  async update(id: number, dto: UpdateEmployeeDto, user: CurrentUserPayload) {
    return this.prisma.withEmployeeManagement(authActor(user), tx => this.updateInTransaction(tx, id, dto));
  }

  async updateStatus(id: number, status: string, user: CurrentUserPayload) {
    return this.prisma.withEmployeeManagement(authActor(user), tx => this.updateStatusInTransaction(tx, id, status));
  }

  async remove(id: number, user: CurrentUserPayload) {
    return this.prisma.withEmployeeManagement(authActor(user), tx => this.removeInTransaction(tx, id));
  }

  private async findAllInTransaction(tx: Prisma.TransactionClient, query?: EmployeeQueryDto) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query?.limit) || 10));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query?.search && query.search.trim() !== '') {
      const s = query.search.trim();
      where.OR = [
        { full_name: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
      ];
    }

    if (query?.role && query.role.trim() !== '') {
      where.role = { equals: query.role.trim(), mode: 'insensitive' };
    }

    if (query?.facilityId) {
      where.facility_id = query.facilityId;
    }

    if (query?.status && query.status.trim() !== '') {
      where.status = { equals: query.status.trim(), mode: 'insensitive' };
    }

    const [total, items] = await Promise.all([
      tx.employees.count({ where }),
      tx.employees.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'desc' },
        include: { facilities: true },
      }),
    ]);

    return {
      items: items.map(formatEmployee),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  private async findOneInTransaction(tx: Prisma.TransactionClient, id: number) {
    const employee = await tx.employees.findUnique({
      where: { id },
      include: { facilities: true },
    });
    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }
    return formatEmployee(employee);
  }

  private async createInTransaction(tx: Prisma.TransactionClient, dto: CreateEmployeeDto) {
    const email = dto.email.trim().toLowerCase();

    const existing = await tx.employees.findFirst({
      where: { email },
    });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const facility = await tx.facilities.findUnique({
      where: { id: dto.facilityId },
    });
    if (!facility) {
      throw new BadRequestException(`Facility with ID ${dto.facilityId} does not exist`);
    }

    const password_hash = await bcrypt.hash(dto.password, 10);

    const newEmp = await tx.employees.create({
      data: {
        email,
        password_hash,
        full_name: dto.fullName.trim(),
        role: dto.role.trim(),
        facility_id: dto.facilityId,
        status: 'ACTIVE',
      },
      include: { facilities: true },
    });

    return formatEmployee(newEmp);
  }

  private async updateInTransaction(tx: Prisma.TransactionClient, id: number, dto: UpdateEmployeeDto) {
    const employee = await tx.employees.findUnique({ where: { id } });
    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    const dataToUpdate: any = {};

    if (dto.email && dto.email.trim().toLowerCase() !== employee.email?.toLowerCase()) {
      const cleanEmail = dto.email.trim().toLowerCase();
      const existing = await tx.employees.findFirst({
        where: { email: cleanEmail, id: { not: id } },
      });
      if (existing) {
        throw new ConflictException('Email is already in use by another account');
      }
      dataToUpdate.email = cleanEmail;
    }

    if (dto.password && dto.password.trim() !== '') {
      dataToUpdate.password_hash = await bcrypt.hash(dto.password, 10);
    }

    if (dto.fullName !== undefined) {
      dataToUpdate.full_name = dto.fullName.trim();
    }

    if (dto.role !== undefined) {
      dataToUpdate.role = dto.role.trim();
    }

    if (dto.facilityId !== undefined) {
      const facility = await tx.facilities.findUnique({
        where: { id: dto.facilityId },
      });
      if (!facility) {
        throw new BadRequestException(`Facility with ID ${dto.facilityId} does not exist`);
      }
      dataToUpdate.facility_id = dto.facilityId;
    }

    if (dto.status !== undefined) {
      dataToUpdate.status = dto.status;
    }

    const updated = await tx.employees.update({
      where: { id },
      data: dataToUpdate,
      include: { facilities: true },
    });

    return formatEmployee(updated);
  }

  private async updateStatusInTransaction(tx: Prisma.TransactionClient, id: number, status: string) {
    await this.findOneInTransaction(tx, id);
    const validStatus = status.toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';

    const updated = await tx.employees.update({
      where: { id },
      data: { status: validStatus },
      include: { facilities: true },
    });

    return formatEmployee(updated);
  }

  private async removeInTransaction(tx: Prisma.TransactionClient, id: number) {
    await this.findOneInTransaction(tx, id);
    await tx.employees.delete({ where: { id } });
    return { success: true, message: `Employee with ID ${id} deleted successfully` };
  }
}
