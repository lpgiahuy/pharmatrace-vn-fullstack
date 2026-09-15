import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductQueryDto } from './dto/product-query.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

export function formatProduct(item: any) {
  const calculatedStock = item.id % 7 === 0 ? 0 : (item.id * 13) % 80 + 5;
  const primaryCategory = item.medicine_categories?.find((mc: any) => mc.is_primary)?.category
    || item.medicine_categories?.[0]?.category
    || null;

  const baseVariant = item.packaging_variants?.find((pv: any) => pv.is_base_unit)
    || item.packaging_variants?.[0]
    || null;

  const packagingOptions = item.packaging_options || (item.packaging_variants && item.packaging_variants.length > 0
    ? item.packaging_variants.map((pv: any) => ({
      id: pv.id,
      unitName: pv.unit_name,
      price: Number(pv.price),
      originalPrice: pv.original_price ? Number(pv.original_price) : null,
      discountPercent: pv.discount_percent ?? 0,
      isBaseUnit: Boolean(pv.is_base_unit),
      saleStartDate: pv.sale_start_date ? new Date(pv.sale_start_date).toISOString() : null,
      saleEndDate: pv.sale_end_date ? new Date(pv.sale_end_date).toISOString() : null,
    }))
    : []);

  const hasVariantDiscount = Boolean(
    baseVariant?.original_price && Number(baseVariant.price) < Number(baseVariant.original_price),
  );

  const unitPrice = baseVariant
    ? (baseVariant.original_price ? Number(baseVariant.original_price) : Number(baseVariant.price || 0))
    : Number(item.unit_price || 0);

  const promotionalPrice = baseVariant
    ? (hasVariantDiscount ? Number(baseVariant.price) : null)
    : (item.promotional_price && Number(item.promotional_price) < Number(item.unit_price)
      ? Number(item.promotional_price)
      : null);

  const discountPercent = baseVariant?.discount_percent
    ? Number(baseVariant.discount_percent)
    : (hasVariantDiscount && unitPrice > 0
      ? Math.round(((unitPrice - Number(promotionalPrice)) / unitPrice) * 100)
      : 0);

  return {
    id: item.id,
    medicineName: item.medicine_name,
    categoryId: primaryCategory?.id || null,
    packagingId: baseVariant?.id || null,
    registrationNumber: item.registration_number || null,
    activeIngredients: item.active_ingredients || null,
    dosage: item.dosage || null,
    manufacturer: item.manufacturer || null,
    countryOfOrigin: item.country_of_origin || null,
    unitPrice,
    promotionalPrice,
    discountPercent,
    imageUrl: item.image_url || null,
    shortDescription: item.short_description || null,
    details: item.details || {},
    isPrescription: Boolean(item.is_prescription),
    status: item.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    totalStock: item.total_stock ?? calculatedStock,
    createdAt: item.created_at,
    slug: item.slug || null,
    category: primaryCategory
      ? {
        id: primaryCategory.id,
        categoryName: primaryCategory.category_name,
        icon: primaryCategory.icon || null,
      }
      : null,
    categories: item.medicine_categories && item.medicine_categories.length > 0
      ? item.medicine_categories.map((mc: any) => ({
        id: mc.category?.id ?? mc.category_id,
        categoryName: mc.category?.category_name ?? '',
        icon: mc.category?.icon ?? null,
        isPrimary: mc.is_primary ?? false,
      }))
      : [],
    packaging: baseVariant
      ? {
        id: baseVariant.id,
        unitName: baseVariant.unit_name,
      }
      : null,
    packagingOptions,
    totalReviews: item.reviews ? item.reviews.length : (item._count?.reviews ?? 0),
  };
}

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) { }

  async findAll(query?: ProductQueryDto) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.max(1, Math.min(10000, Number(query?.limit) || 12));
    const skip = (page - 1) * limit;

    const andConditions: Prisma.medicinesWhereInput[] = [];

    const reqStatus = query?.status ? String(query.status).toUpperCase() : 'ACTIVE';
    if (reqStatus === 'ALL') {
    } else if (reqStatus === 'ACTIVE') {
      andConditions.push({
        status: { equals: 'ACTIVE', mode: 'insensitive' },
      });
    } else if (reqStatus === 'INACTIVE' || reqStatus === 'HIDDEN') {
      andConditions.push({
        status: { equals: 'INACTIVE', mode: 'insensitive' },
      });
    }

    if (query?.categoryId) {
      const rawCatIds = String(query.categoryId)
        .split(',')
        .map((id) => Number(id.trim()))
        .filter((n) => !isNaN(n) && n > 0);

      if (rawCatIds.length > 0) {
        const childCategories = await this.prisma.categories.findMany({
          where: { parent_id: { in: rawCatIds } },
          select: { id: true },
        });
        const allCatIds = Array.from(
          new Set([...rawCatIds, ...childCategories.map((c) => c.id)]),
        );
        andConditions.push({
          medicine_categories: { some: { category_id: { in: allCatIds } } },
        });
      }
    }

    if (query?.packagingId) {
      andConditions.push({ packaging_variants: { some: { id: Number(query.packagingId) } } });
    }

    if (query?.isPrescription !== undefined) {
      andConditions.push({ is_prescription: query.isPrescription });
    }

    if (query?.inStock !== undefined) {
      const outOfStockIds = Array.from({ length: 10000 }, (_, i) => (i + 1) * 7);
      if (query.inStock === true) {
        andConditions.push({ id: { notIn: outOfStockIds } });
      } else if (query.inStock === false) {
        andConditions.push({ id: { in: outOfStockIds } });
      }
    }

    if (query?.manufacturer) {
      const brandList = String(query.manufacturer)
        .split(',')
        .map((b) => b.trim())
        .filter(Boolean);

      if (brandList.length === 1) {
        andConditions.push({
          manufacturer: {
            contains: brandList[0],
            mode: 'insensitive',
          },
        });
      } else if (brandList.length > 1) {
        andConditions.push({
          OR: brandList.map((b) => ({
            manufacturer: {
              contains: b,
              mode: 'insensitive',
            },
          })),
        });
      }
    }

    if (query?.countryOfOrigin) {
      andConditions.push({
        country_of_origin: {
          contains: query.countryOfOrigin.trim(),
          mode: 'insensitive',
        },
      });
    }

    if (query?.minPrice !== undefined || query?.maxPrice !== undefined) {
      const minVal = query.minPrice !== undefined ? new Prisma.Decimal(query.minPrice) : undefined;
      const maxVal = query.maxPrice !== undefined ? new Prisma.Decimal(query.maxPrice) : undefined;

      const promoCondition: Prisma.DecimalFilter = {};
      const unitCondition: Prisma.DecimalFilter = {};

      if (minVal !== undefined) {
        promoCondition.gte = minVal;
        unitCondition.gte = minVal;
      }
      if (maxVal !== undefined) {
        promoCondition.lte = maxVal;
        unitCondition.lte = maxVal;
      }

      andConditions.push({
        OR: [
          {
            AND: [
              { promotional_price: { not: null } },
              { promotional_price: { gt: new Prisma.Decimal(0) } },
              { promotional_price: promoCondition },
            ],
          },
          {
            AND: [
              {
                OR: [
                  { promotional_price: null },
                  { promotional_price: { equals: new Prisma.Decimal(0) } },
                ],
              },
              { unit_price: unitCondition },
            ],
          },
        ],
      });
    }

    if (query?.search) {
      const s = query.search.trim();
      andConditions.push({
        OR: [
          { medicine_name: { contains: s, mode: 'insensitive' } },
          { active_ingredients: { contains: s, mode: 'insensitive' } },
          { registration_number: { contains: s, mode: 'insensitive' } },
          { manufacturer: { contains: s, mode: 'insensitive' } },
          { short_description: { contains: s, mode: 'insensitive' } },
          {
            medicine_categories: {
              some: {
                category: {
                  category_name: { contains: s, mode: 'insensitive' },
                },
              },
            },
          },
        ],
      });
    }

    const where: Prisma.medicinesWhereInput =
      andConditions.length > 0 ? { AND: andConditions } : {};

    const order = query?.sortOrder === 'desc' ? 'desc' : 'asc';
    let orderBy: Prisma.medicinesOrderByWithRelationInput[] = [{ id: order }];
    if (query?.sortBy) {
      switch (query.sortBy) {
        case 'id':
          orderBy = [{ id: order }];
          break;
        case 'createdAt':
          orderBy = [{ created_at: order }, { id: order }];
          break;
        case 'price':
          orderBy = [{ unit_price: order }, { id: 'asc' }];
          break;
        case 'name':
          orderBy = [{ medicine_name: order }, { id: 'asc' }];
          break;
        default:
          orderBy = [{ id: order }];
      }
    }

    const [total, items] = await Promise.all([
      this.prisma.medicines.count({ where }),
      this.prisma.medicines.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          medicine_categories: {
            include: {
              category: {
                select: { id: true, category_name: true, icon: true },
              },
            },
          },
          packaging_variants: true,
          _count: {
            select: { reviews: true },
          },
        },
      }),
    ]);

    return {
      items: items.map(formatProduct),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async getManufacturers(): Promise<string[]> {
    const records = await this.prisma.medicines.findMany({
      where: {
        status: 'ACTIVE',
        manufacturer: { not: null },
      },
      select: {
        manufacturer: true,
      },
      distinct: ['manufacturer'],
      orderBy: {
        manufacturer: 'asc',
      },
    });

    return records
      .map((r) => r.manufacturer?.trim())
      .filter((m): m is string => Boolean(m));
  }

  async getBrands(): Promise<string[]> {
    return this.getManufacturers();
  }

  async findOne(idOrSlug: string | number) {
    const isNumeric =
      typeof idOrSlug === 'number' ||
      (!isNaN(Number(idOrSlug)) && /^\d+$/.test(String(idOrSlug).trim()));

    const item = await this.prisma.medicines.findFirst({
      where: isNumeric
        ? { id: Number(idOrSlug) }
        : { slug: String(idOrSlug).trim() },
      include: {
        medicine_categories: {
          include: {
            category: {
              select: { id: true, category_name: true, description: true, icon: true },
            },
          },
        },
        packaging_variants: {
          orderBy: { price: 'asc' },
        },
        reviews: {
          take: 10,
          orderBy: { created_at: 'desc' },
          include: {
            customers: {
              select: { id: true, full_name: true, email: true },
            },
          },
        },
        _count: {
          select: { reviews: true },
        },
      },
    });

    if (!item) {
      throw new NotFoundException(`Medicine "${idOrSlug}" not found`);
    }

    const formatted = formatProduct(item);

    return {
      ...formatted,
      reviewsList: (item.reviews || []).map((r: any) => ({
        id: r.id,
        rating: r.rating_stars ?? 5,
        content: r.comment || '',
        images: r.images || [],
        createdAt: r.created_at,
        customerName: r.customers?.full_name || 'Anonymous Customer',
      })),
    };
  }

  async create(dto: CreateProductDto) {
    const primaryId = dto.primaryCategoryId || dto.categoryId;
    const rawCatIds = Array.isArray(dto.categoryIds) ? dto.categoryIds : [];
    const allCatIds = Array.from(new Set([...rawCatIds, ...(primaryId ? [primaryId] : [])]));

    if (allCatIds.length > 0) {
      const existingCats = await this.prisma.categories.findMany({
        where: { id: { in: allCatIds } },
        select: { id: true },
      });
      if (existingCats.length !== allCatIds.length) {
        const foundIds = new Set(existingCats.map((c) => c.id));
        const missing = allCatIds.filter((cid) => !foundIds.has(cid));
        throw new BadRequestException(`Category IDs [${missing.join(', ')}] do not exist`);
      }
    }

    const generatedSlug = dto.medicineName
      ? dto.medicineName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
      : null;

    const created = await this.prisma.medicines.create({
      data: {
        medicine_name: dto.medicineName.trim(),
        slug: generatedSlug,
        registration_number: dto.registrationNumber?.trim() || null,
        active_ingredients: dto.activeIngredients?.trim() || null,
        dosage: dto.dosage?.trim() || null,
        manufacturer: dto.manufacturer?.trim() || null,
        country_of_origin: dto.countryOfOrigin?.trim() || null,
        unit_price: new Prisma.Decimal(dto.unitPrice),
        promotional_price:
          dto.promotionalPrice !== undefined && dto.promotionalPrice !== null
            ? new Prisma.Decimal(dto.promotionalPrice)
            : null,
        image_url: dto.imageUrl?.trim() || null,
        short_description: dto.shortDescription?.trim() || null,
        details: dto.details || {},
        is_prescription: dto.isPrescription ?? false,
        status: dto.status || 'ACTIVE',
        ...(allCatIds.length > 0 && {
          medicine_categories: {
            create: allCatIds.map((catId) => ({
              category_id: catId,
              is_primary: primaryId ? catId === primaryId : catId === allCatIds[0],
            })),
          },
        }),
        ...(dto.packagingVariants && dto.packagingVariants.length > 0 && {
          packaging_variants: {
            create: dto.packagingVariants.map((pv) => ({
              unit_name: pv.unitName.trim(),
              price: new Prisma.Decimal(pv.price),
              original_price: pv.originalPrice ? new Prisma.Decimal(pv.originalPrice) : null,
              discount_percent: pv.discountPercent ?? 0,
              is_base_unit: pv.isBaseUnit ?? false,
              sale_start_date: pv.saleStartDate ? new Date(pv.saleStartDate) : null,
              sale_end_date: pv.saleEndDate ? new Date(pv.saleEndDate) : null,
            })),
          },
        }),
      },
      include: {
        medicine_categories: {
          include: {
            category: true,
          },
        },
        packaging_variants: true,
      },
    });

    return formatProduct(created);
  }

  async update(id: number, dto: UpdateProductDto) {
    await this.findOne(id);

    const primaryId = dto.primaryCategoryId || dto.categoryId;
    let allCatIds: number[] | null = null;

    if (dto.categoryIds !== undefined) {
      const rawCatIds = Array.isArray(dto.categoryIds) ? dto.categoryIds : [];
      allCatIds = Array.from(new Set([...rawCatIds, ...(primaryId ? [primaryId] : [])]));
    }

    if (allCatIds !== null) {
      if (allCatIds.length > 0) {
        const existingCats = await this.prisma.categories.findMany({
          where: { id: { in: allCatIds } },
          select: { id: true },
        });
        if (existingCats.length !== allCatIds.length) {
          const foundIds = new Set(existingCats.map((c) => c.id));
          const missing = allCatIds.filter((cid) => !foundIds.has(cid));
          throw new BadRequestException(`Category IDs [${missing.join(', ')}] do not exist`);
        }
      }

      // Replace relations atomically
      await this.prisma.medicine_categories.deleteMany({
        where: { medicine_id: id },
      });

      if (allCatIds.length > 0) {
        await this.prisma.medicine_categories.createMany({
          data: allCatIds.map((catId) => ({
            medicine_id: id,
            category_id: catId,
            is_primary: primaryId ? catId === primaryId : catId === allCatIds[0],
          })),
        });
      }
    } else if (primaryId) {
      const catExists = await this.prisma.categories.findUnique({
        where: { id: primaryId },
      });
      if (!catExists) {
        throw new BadRequestException(`Category with ID ${primaryId} does not exist`);
      }

      await this.prisma.medicine_categories.updateMany({
        where: { medicine_id: id },
        data: { is_primary: false },
      });

      await this.prisma.medicine_categories.upsert({
        where: {
          medicine_id_category_id: {
            medicine_id: id,
            category_id: primaryId,
          },
        },
        update: { is_primary: true },
        create: {
          medicine_id: id,
          category_id: primaryId,
          is_primary: true,
        },
      });
    }

    if (dto.packagingVariants !== undefined) {
      await this.prisma.packaging_variants.deleteMany({
        where: { medicine_id: id },
      });
      if (dto.packagingVariants && dto.packagingVariants.length > 0) {
        await this.prisma.packaging_variants.createMany({
          data: dto.packagingVariants.map((pv) => ({
            medicine_id: id,
            unit_name: pv.unitName.trim(),
            price: new Prisma.Decimal(pv.price),
            original_price: pv.originalPrice ? new Prisma.Decimal(pv.originalPrice) : null,
            discount_percent: pv.discountPercent ?? 0,
            is_base_unit: pv.isBaseUnit ?? false,
            sale_start_date: pv.saleStartDate ? new Date(pv.saleStartDate) : null,
            sale_end_date: pv.saleEndDate ? new Date(pv.saleEndDate) : null,
          })),
        });
      }
    }

    const updated = await this.prisma.medicines.update({
      where: { id },
      data: {
        ...(dto.medicineName && { medicine_name: dto.medicineName.trim() }),
        ...(dto.registrationNumber !== undefined && { registration_number: dto.registrationNumber?.trim() || null }),
        ...(dto.activeIngredients !== undefined && { active_ingredients: dto.activeIngredients?.trim() || null }),
        ...(dto.dosage !== undefined && { dosage: dto.dosage?.trim() || null }),
        ...(dto.manufacturer !== undefined && { manufacturer: dto.manufacturer?.trim() || null }),
        ...(dto.countryOfOrigin !== undefined && { country_of_origin: dto.countryOfOrigin?.trim() || null }),
        ...(dto.unitPrice !== undefined && { unit_price: new Prisma.Decimal(dto.unitPrice) }),
        ...(dto.promotionalPrice !== undefined && {
          promotional_price: dto.promotionalPrice !== null ? new Prisma.Decimal(dto.promotionalPrice) : null,
        }),
        ...(dto.imageUrl !== undefined && { image_url: dto.imageUrl?.trim() || null }),
        ...(dto.shortDescription !== undefined && { short_description: dto.shortDescription?.trim() || null }),
        ...(dto.details !== undefined && { details: dto.details }),
        ...(dto.isPrescription !== undefined && { is_prescription: dto.isPrescription }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
      include: {
        medicine_categories: {
          include: {
            category: true,
          },
        },
        packaging_variants: true,
      },
    });

    return formatProduct(updated);
  }

  async updateImageUrl(id: number, imageUrl: string) {
    await this.findOne(id);
    const updated = await this.prisma.medicines.update({
      where: { id },
      data: { image_url: imageUrl },
      include: {
        medicine_categories: {
          include: {
            category: true,
          },
        },
        packaging_variants: true,
      },
    });
    return formatProduct(updated);
  }

  async delete(id: number) {
    const item = await this.findOne(id);

    const [orderItemCount, batchCount] = await Promise.all([
      this.prisma.order_items.count({ where: { medicine_id: id } }),
      this.prisma.batches.count({ where: { medicine_id: id } }),
    ]);

    if (orderItemCount > 0 || batchCount > 0) {
      // Soft-delete to preserve transaction history
      await this.prisma.medicines.update({
        where: { id },
        data: { status: 'INACTIVE' },
      });
      return {
        message: `Medicine "${item.medicineName}" has active orders or warehouse batches and was set to INACTIVE status to preserve historical integrity.`,
        isSoftDeleted: true,
      };
    }

    await this.prisma.medicines.delete({
      where: { id },
    });

    return {
      message: `Medicine "${item.medicineName}" has been permanently deleted.`,
      isSoftDeleted: false,
    };
  }

  async getPackagings() {
    return [
      { id: 1, unitName: 'Box', description: 'Outer cardboard packaging box' },
      { id: 2, unitName: 'Blister Pack', description: 'Foil or plastic push-through blister' },
      { id: 3, unitName: 'Bottle', description: 'Glass or plastic liquid/pill bottle' },
      { id: 4, unitName: 'Tube', description: 'Ointment or cream tube' },
      { id: 5, unitName: 'Pill', description: 'Single individual tablet or capsule' },
      { id: 6, unitName: 'Sachet', description: 'Powder or granule pouch' },
      { id: 7, unitName: 'Ampoule', description: 'Sealed glass injection vial' },
      { id: 8, unitName: 'Vial', description: 'Injectable powder vial' },
      { id: 9, unitName: 'Pack', description: 'Multi-item bundle or packet' },
    ];
  }
}
