import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { VoucherService } from './voucher.service';
import { ValidateVoucherDto } from './dto/validate-voucher.dto';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';
import { VoucherQueryDto } from './dto/voucher-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Vouchers & Promotions')
@Controller()
export class VoucherController {
  constructor(private readonly voucherService: VoucherService) { }

  // Public/Customer: Validate voucher
  @Post('vouchers/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate discount voucher code',
    description: 'Validates voucher code against subtotal, date validity, and usage capacity.',
  })
  @ApiResponse({ status: 200, description: 'Voucher is valid' })
  @ApiResponse({ status: 400, description: 'Voucher expired, subtotal insufficient, or usage limit exceeded' })
  @ApiResponse({ status: 404, description: 'Voucher not found' })
  async validateVoucher(@Body() dto: ValidateVoucherDto) {
    const result = await this.voucherService.validateVoucher(dto);
    return {
      success: true,
      message: result.message,
      data: result,
    };
  }

  // Apply voucher during checkout / order placement 
  @Post('vouchers/apply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Apply and consume discount voucher',
    description: 'Validates and records usage for the voucher.',
  })
  @ApiResponse({ status: 200, description: 'Voucher applied and usage recorded successfully' })
  @ApiResponse({ status: 400, description: 'Voucher invalid or usage limit reached' })
  async applyVoucher(@Body() dto: ValidateVoucherDto) {
    const result = await this.voucherService.applyVoucher(dto);
    return {
      success: true,
      message: result.message,
      data: result,
    };
  }

  // Admin Management Endpoints
  @Get('admin/vouchers')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'PHARMACIST', 'Pharmacist')
  @ApiOperation({
    summary: 'Get paginated vouchers list (Admin)',
    description: 'Retrieves all vouchers with code search and status filtering.',
  })
  @ApiResponse({ status: 200, description: 'Vouchers retrieved successfully' })
  async findAll(@Query() query: VoucherQueryDto) {
    const result = await this.voucherService.findAll(query);
    return {
      success: true,
      message: 'Vouchers retrieved successfully',
      data: result.items,
      pagination: result.pagination,
    };
  }

  @Get('admin/vouchers/:id')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'PHARMACIST', 'Pharmacist')
  @ApiOperation({ summary: 'Get voucher details by ID (Admin)' })
  @ApiResponse({ status: 200, description: 'Voucher retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Voucher not found' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.voucherService.findOne(id);
    return {
      success: true,
      data,
    };
  }

  @Post('admin/vouchers')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager')
  @ApiOperation({ summary: 'Create new voucher (Admin)' })
  @ApiResponse({ status: 201, description: 'Voucher created successfully' })
  @ApiResponse({ status: 409, description: 'Voucher code already exists' })
  async create(@Body() dto: CreateVoucherDto) {
    const data = await this.voucherService.create(dto);
    return {
      success: true,
      message: 'Voucher created successfully',
      data,
    };
  }

  @Patch('admin/vouchers/:id')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager')
  @ApiOperation({ summary: 'Update voucher by ID (Admin)' })
  @ApiResponse({ status: 200, description: 'Voucher updated successfully' })
  @ApiResponse({ status: 404, description: 'Voucher not found' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVoucherDto,
  ) {
    const data = await this.voucherService.update(id, dto);
    return {
      success: true,
      message: 'Voucher updated successfully',
      data,
    };
  }

  @Delete('admin/vouchers/:id')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager')
  @ApiOperation({ summary: 'Delete voucher by ID (Admin)' })
  @ApiResponse({ status: 200, description: 'Voucher deleted successfully' })
  @ApiResponse({ status: 404, description: 'Voucher not found' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.voucherService.remove(id);
  }
}
