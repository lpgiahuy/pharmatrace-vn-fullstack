import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

export interface FormattedCategory {
  id: number;
  categoryName: string;
  description: string | null;
  icon: string | null;
  parentId: number | null;
  displayOrder: number;
  status: string;
  totalMedicines: number;
  children?: FormattedCategory[];
}

function formatCategory(cat: any): FormattedCategory {
  return {
    id: cat.id,
    categoryName: cat.category_name,
    description: cat.description || null,
    icon: cat.icon || null,
    parentId: cat.parent_id || null,
    displayOrder: Number(cat.display_order || 0),
    status: cat.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    totalMedicines: cat._count?.medicines ?? 0,
  };
}

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) { }

  async findAll(): Promise<FormattedCategory[]> {
    const list = await this.prisma.categories.findMany({
      orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
      include: {
        _count: {
          select: { medicines: true },
        },
      },
    });

    return list.map(formatCategory);
  }

  async getCategoryTree() {
    const flatList = await this.findAll();
    const map = new Map<number, FormattedCategory & { key: number; title: string; children: any[] }>();
    const tree: any[] = [];

    flatList.forEach((item) => {
      map.set(item.id, {
        ...item,
        key: item.id,
        title: item.categoryName,
        children: [],
      });
    });

    flatList.forEach((item) => {
      const mappedItem = map.get(item.id)!;
      if (item.parentId && map.has(item.parentId)) {
        const parent = map.get(item.parentId)!;
        parent.children.push(mappedItem);
      } else {
        tree.push(mappedItem);
      }
    });

    const cleanEmptyChildren = (nodes: any[]) => {
      nodes.forEach((node) => {
        if (node.children && node.children.length === 0) {
          delete node.children;
        } else if (node.children) {
          cleanEmptyChildren(node.children);
        }
      });
    };
    cleanEmptyChildren(tree);

    return tree;
  }

  async findOne(id: number): Promise<FormattedCategory> {
    const cat = await this.prisma.categories.findUnique({
      where: { id },
      include: {
        _count: {
          select: { medicines: true },
        },
      },
    });

    if (!cat) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    return formatCategory(cat);
  }

  async create(dto: CreateCategoryDto): Promise<FormattedCategory> {
    const existing = await this.prisma.categories.findFirst({
      where: {
        category_name: {
          equals: dto.categoryName.trim(),
          mode: 'insensitive',
        },
      },
    });

    if (existing) {
      throw new ConflictException(`Category "${dto.categoryName}" already exists`);
    }

    const created = await this.prisma.categories.create({
      data: {
        category_name: dto.categoryName.trim(),
        description: dto.description?.trim() || null,
        icon: dto.icon?.trim() || null,
        parent_id: dto.parentId ? Number(dto.parentId) : null,
        display_order: dto.displayOrder ? Number(dto.displayOrder) : 0,
        status: dto.status || 'ACTIVE',
      },
      include: {
        _count: {
          select: { medicines: true },
        },
      },
    });

    return formatCategory(created);
  }

  async update(id: number, dto: UpdateCategoryDto): Promise<FormattedCategory> {
    const existing = await this.prisma.categories.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    if (dto.categoryName) {
      const duplicate = await this.prisma.categories.findFirst({
        where: {
          category_name: {
            equals: dto.categoryName.trim(),
            mode: 'insensitive',
          },
          NOT: { id },
        },
      });

      if (duplicate) {
        throw new ConflictException(`Category "${dto.categoryName}" already exists`);
      }
    }

    const updated = await this.prisma.categories.update({
      where: { id },
      data: {
        ...(dto.categoryName ? { category_name: dto.categoryName.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon?.trim() || null } : {}),
        ...(dto.parentId !== undefined ? { parent_id: dto.parentId ? Number(dto.parentId) : null } : {}),
        ...(dto.displayOrder !== undefined ? { display_order: Number(dto.displayOrder) } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
      include: {
        _count: {
          select: { medicines: true },
        },
      },
    });

    return formatCategory(updated);
  }

  async delete(id: number): Promise<{ success: boolean; message: string }> {
    const existing = await this.prisma.categories.findUnique({
      where: { id },
      include: {
        _count: {
          select: { medicines: true, children: true },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    if (existing._count.medicines > 0) {
      throw new BadRequestException(
        `Cannot delete category. It is currently associated with ${existing._count.medicines} medicine(s).`,
      );
    }

    if (existing._count.children > 0) {
      throw new BadRequestException(
        `Cannot delete category. It currently contains ${existing._count.children} sub-category(ies).`,
      );
    }

    await this.prisma.categories.delete({
      where: { id },
    });

    return {
      success: true,
      message: `Category "${existing.category_name}" deleted successfully`,
    };
  }
}
