import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Categories')
@Controller()
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) { }

  // Public Endpoints

  @Get('categories')
  @ApiOperation({
    summary: 'Get all categories (Public)',
    description: 'Returns the full list of medicine categories with associated product counts.',
  })
  @ApiResponse({ status: 200, description: 'Categories retrieved successfully' })
  async findAll() {
    const data = await this.categoryService.findAll();
    return {
      success: true,
      message: 'Categories retrieved successfully',
      data,
    };
  }

  @Get('categories/tree')
  @ApiOperation({
    summary: 'Get category tree (Public)',
    description: 'Returns categories in a tree / hierarchical representation for navigation menus.',
  })
  @ApiResponse({ status: 200, description: 'Category tree retrieved successfully' })
  async getCategoryTree() {
    const data = await this.categoryService.getCategoryTree();
    return {
      success: true,
      message: 'Category tree retrieved successfully',
      data,
    };
  }

  @Get('categories/:id')
  @ApiOperation({
    summary: 'Get category by ID or Slug (Public)',
    description: 'Returns details of a single category by numerical ID or URL slug.',
  })
  @ApiResponse({ status: 200, description: 'Category retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async findOne(@Param('id') id: string) {
    const data = await this.categoryService.findOne(id);
    return {
      success: true,
      message: 'Category retrieved successfully',
      data,
    };
  }

  // Admin Endpoints

  @Post('admin/categories')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager')
  @ApiOperation({
    summary: 'Create category (Admin)',
    description: 'Creates a new medicine category.',
  })
  @ApiResponse({ status: 201, description: 'Category created successfully' })
  @ApiResponse({ status: 409, description: 'Category already exists' })
  async create(@Body() dto: CreateCategoryDto) {
    const data = await this.categoryService.create(dto);
    return {
      success: true,
      message: 'Category created successfully',
      data,
    };
  }

  @Put('admin/categories/:id')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager')
  @ApiOperation({
    summary: 'Update category (Admin)',
    description: 'Updates an existing medicine category.',
  })
  @ApiResponse({ status: 200, description: 'Category updated successfully' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @ApiResponse({ status: 409, description: 'Category name already exists' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
  ) {
    const data = await this.categoryService.update(id, dto);
    return {
      success: true,
      message: 'Category updated successfully',
      data,
    };
  }

  @Delete('admin/categories/:id')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager')
  @ApiOperation({
    summary: 'Delete category (Admin)',
    description: 'Deletes a category if no medicines are attached.',
  })
  @ApiResponse({ status: 200, description: 'Category deleted successfully' })
  @ApiResponse({ status: 400, description: 'Category has attached medicines' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async delete(@Param('id', ParseIntPipe) id: number) {
    const result = await this.categoryService.delete(id);
    return {
      success: true,
      message: result.message,
      data: result,
    };
  }
}
