import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateFacilityDto } from './dto/create-facility.dto';
import { UpdateFacilityDto } from './dto/update-facility.dto';
import { FacilityQueryDto } from './dto/facility-query.dto';

export function formatFacility(f: any) {
  return {
    id: f.id,
    name: f.facility_name,
    type: f.facility_type,
    address: f.address || null,
    phoneNumber: f.phone_number || null,
    email: f.email || null,
    latitude: f.latitude ? Number(f.latitude) : null,
    longitude: f.longitude ? Number(f.longitude) : null,
    createdAt: f.created_at,
    totalEmployees: f._count?.employees ?? undefined,
    totalInventories: f._count?.inventories ?? undefined,
  };
}

@Injectable()
export class FacilityService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query?: FacilityQueryDto) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query?.limit) || 10));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query?.search && query.search.trim() !== '') {
      const s = query.search.trim();
      where.OR = [
        { facility_name: { contains: s, mode: 'insensitive' } },
        { address: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
      ];
    }

    if (query?.type && query.type.trim() !== '') {
      where.facility_type = { equals: query.type.trim(), mode: 'insensitive' };
    }

    const [total, items] = await Promise.all([
      this.prisma.facilities.count({ where }),
      this.prisma.facilities.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'asc' },
        include: {
          _count: {
            select: {
              employees: true,
              inventories: true,
            },
          },
        },
      }),
    ]);

    return {
      items: items.map(formatFacility),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getStats() {
    const all = await this.prisma.facilities.findMany({
      select: { id: true, facility_type: true },
    });

    let total = all.length;
    let manufacturers = 0;
    let warehouses = 0;
    let pharmacies = 0;

    all.forEach((f) => {
      const t = (f.facility_type || '').toUpperCase();
      if (t === 'MANUFACTURER') manufacturers++;
      else if (t === 'PHARMACY') pharmacies++;
      else if (t === 'CENTRAL_WAREHOUSE' || t === 'BRANCH_WAREHOUSE') warehouses++;
      else warehouses++;
    });

    return {
      total,
      manufacturers,
      warehouses,
      pharmacies,
    };
  }

  async getDropdownList() {
    const list = await this.prisma.facilities.findMany({
      orderBy: { facility_name: 'asc' },
      select: {
        id: true,
        facility_name: true,
        facility_type: true,
        address: true,
        latitude: true,
        longitude: true,
      },
    });

    return list.map(formatFacility);
  }

  async findOne(id: number) {
    const facility = await this.prisma.facilities.findUnique({
      where: { id },
      include: {
        employees: {
          select: {
            id: true,
            full_name: true,
            email: true,
            role: true,
            status: true,
          },
        },
        _count: {
          select: {
            employees: true,
            inventories: true,
            orders: true,
            batches: true,
          },
        },
      },
    });

    if (!facility) {
      throw new NotFoundException(`Facility with ID ${id} not found`);
    }

    return {
      ...formatFacility(facility),
      employees: facility.employees.map((e) => ({
        id: e.id,
        fullName: e.full_name,
        email: e.email,
        role: e.role,
        status: e.status,
      })),
      stats: facility._count,
    };
  }

  async create(dto: CreateFacilityDto) {
    const created = await this.prisma.facilities.create({
      data: {
        facility_name: dto.name.trim(),
        facility_type: dto.type.trim(),
        address: dto.address?.trim() || null,
        phone_number: dto.phoneNumber?.trim() || null,
        email: dto.email?.trim() || null,
        latitude: dto.latitude !== undefined ? dto.latitude : null,
        longitude: dto.longitude !== undefined ? dto.longitude : null,
      },
    });

    return formatFacility(created);
  }

  async update(id: number, dto: UpdateFacilityDto) {
    await this.findOne(id);

    const dataToUpdate: any = {};
    if (dto.name !== undefined) dataToUpdate.facility_name = dto.name.trim();
    if (dto.type !== undefined) dataToUpdate.facility_type = dto.type.trim();
    if (dto.address !== undefined) dataToUpdate.address = dto.address?.trim() || null;
    if (dto.phoneNumber !== undefined) dataToUpdate.phone_number = dto.phoneNumber?.trim() || null;
    if (dto.email !== undefined) dataToUpdate.email = dto.email?.trim() || null;
    if (dto.latitude !== undefined) dataToUpdate.latitude = dto.latitude;
    if (dto.longitude !== undefined) dataToUpdate.longitude = dto.longitude;

    const updated = await this.prisma.facilities.update({
      where: { id },
      data: dataToUpdate,
    });

    return formatFacility(updated);
  }

  async remove(id: number) {
    const facility = await this.findOne(id);

    if (facility.stats?.employees > 0) {
      throw new BadRequestException(
        `Cannot delete facility: ${facility.stats.employees} employee(s) are assigned to this facility. Reassign employees first.`,
      );
    }

    if (facility.stats?.inventories > 0) {
      throw new BadRequestException(
        `Cannot delete facility: inventory records exist at this location.`,
      );
    }

    await this.prisma.facilities.delete({ where: { id } });

    return {
      success: true,
      message: `Facility "${facility.name}" (#${id}) deleted successfully`,
    };
  }
}
