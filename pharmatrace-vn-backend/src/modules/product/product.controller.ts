import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ProductService } from './product.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { ProductQueryDto } from './dto/product-query.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Products')
@Controller()
export class ProductController {
  constructor(
    private readonly productService: ProductService,
    private readonly cloudinaryService: CloudinaryService,
  ) { }

  // Public Endpoints

  @Get('products')
  @ApiOperation({
    summary: 'Get paginated product list (Public)',
    description: 'Retrieves medicines with multi-criteria filtering, search, sorting, and pagination.',
  })
  @ApiResponse({ status: 200, description: 'Products retrieved successfully' })
  async findAll(@Query() query: ProductQueryDto) {
    const result = await this.productService.findAll({
      ...query,
      status: query.status || 'ACTIVE',
    });
    return {
      success: true,
      message: 'Products retrieved successfully',
      data: result.items,
      pagination: result.pagination,
    };
  }

  @Get('products/brands')
  @ApiOperation({
    summary: 'Get all active brands/manufacturers (Public)',
    description: 'Returns list of distinct pharmaceutical manufacturers and brands for filtering.',
  })
  @ApiResponse({ status: 200, description: 'Brands retrieved successfully' })
  async getBrands() {
    const data = await this.productService.getBrands();
    return {
      success: true,
      message: 'Brands retrieved successfully',
      data,
    };
  }

  @Get('products/packagings')
  @ApiOperation({
    summary: 'Get all packaging specifications (Public)',
    description: 'Returns list of unit packaging specifications (e.g. Box, Bottle, Blister, Tube).',
  })
  @ApiResponse({ status: 200, description: 'Packaging specifications retrieved successfully' })
  async getPackagings() {
    const data = await this.productService.getPackagings();
    return {
      success: true,
      message: 'Packaging specifications retrieved successfully',
      data,
    };
  }

  @Get('products/:id')
  @ApiOperation({
    summary: 'Get product details by ID (Public)',
    description: 'Returns comprehensive medicine details, category, packaging, and recent reviews.',
  })
  @ApiResponse({ status: 200, description: 'Product retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async findOne(@Param('id') id: string) {
    const data = await this.productService.findOne(id);
    return {
      success: true,
      message: 'Product retrieved successfully',
      data,
    };
  }

  // Admin Endpoints

  @Post('admin/products')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager')
  @ApiOperation({
    summary: 'Create medicine product (Admin)',
    description: 'Adds a new medicine product to the catalog.',
  })
  @ApiResponse({ status: 201, description: 'Product created successfully' })
  async create(@Body() dto: CreateProductDto) {
    const data = await this.productService.create(dto);
    return {
      success: true,
      message: 'Product created successfully',
      data,
    };
  }

  @Put('admin/products/:id')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager')
  @ApiOperation({
    summary: 'Update medicine product (Admin)',
    description: 'Updates information of an existing medicine product.',
  })
  @ApiResponse({ status: 200, description: 'Product updated successfully' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
  ) {
    const data = await this.productService.update(id, dto);
    return {
      success: true,
      message: 'Product updated successfully',
      data,
    };
  }

  @Delete('admin/products/:id')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager')
  @ApiOperation({
    summary: 'Delete or deactivate medicine product (Admin)',
    description: 'Deletes product permanently if unused, or sets status to INACTIVE if referenced by orders/batches.',
  })
  @ApiResponse({ status: 200, description: 'Product removed or deactivated' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async delete(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    const result = await this.productService.delete(id, user);
    return {
      success: true,
      message: result.message,
      data: result,
    };
  }

  @Post('admin/products/upload-image')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager')
  @ApiOperation({
    summary: 'Upload image to Cloudinary (Admin)',
    description: 'Uploads an image to Cloudinary and returns the secure URL.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB max
      },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|webp|gif|svg\+xml)$/)) {
          return cb(
            new BadRequestException('Only image files (jpg, jpeg, png, webp, gif, svg) are allowed!'),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async uploadImageStandalone(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('Please provide an image file to upload');
    }

    const uploadResult = await this.cloudinaryService.uploadImage(file);

    return {
      success: true,
      message: 'Product image uploaded to Cloudinary successfully',
      data: {
        imageUrl: uploadResult.secure_url,
        publicId: uploadResult.public_id,
      },
    };
  }

  @Post('admin/products/:id/images')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager')
  @ApiOperation({
    summary: 'Upload product image to Cloudinary and link to product (Admin)',
    description: 'Uploads an image file to Cloudinary and updates the medicine record image_url.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB max
      },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|webp|gif|svg\+xml)$/)) {
          return cb(
            new BadRequestException('Only image files (jpg, jpeg, png, webp, gif, svg) are allowed!'),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async uploadImage(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: any,
  ) {
    if (!file) {
      throw new BadRequestException('Please provide an image file to upload');
    }

    const uploadResult = await this.cloudinaryService.uploadImage(file);
    const imageUrl = uploadResult.secure_url;
    const data = await this.productService.updateImageUrl(id, imageUrl);

    return {
      success: true,
      message: 'Product image uploaded to Cloudinary successfully',
      data: {
        ...data,
        imageUrl,
      },
    };
  }
}

