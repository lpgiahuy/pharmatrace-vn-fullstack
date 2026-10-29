import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CustomerService } from './customer.service';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { UpdateCustomerStatusDto } from './dto/update-customer-status.dto';
import { CustomerOrderQueryDto } from './dto/customer-order-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Admin - Customer Management')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'PHARMACIST', 'Pharmacist')
@Controller('admin/customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get()
  @ApiOperation({
    summary: 'Get paginated customer list',
    description: 'Retrieves customers with pagination, membership tier filter, status filter, and keyword search (name, email, phone).',
  })
  @ApiResponse({ status: 200, description: 'Customers retrieved successfully' })
  async findAll(@Query() query: CustomerQueryDto, @CurrentUser() user: CurrentUserPayload) {
    const result = await this.customerService.findAll(query, user);
    return {
      success: true,
      message: 'Customers retrieved successfully',
      data: result.items,
      pagination: result.pagination,
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get customer details by ID',
    description: 'Retrieves customer profile along with calculated order statistics.',
  })
  @ApiResponse({ status: 200, description: 'Customer retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  async findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    const data = await this.customerService.findOne(id, user);
    return {
      success: true,
      message: 'Customer retrieved successfully',
      data,
    };
  }

  @Patch(':id/status')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager')
  @ApiOperation({
    summary: 'Lock or unlock customer account',
    description: 'Updates customer account status to ACTIVE, INACTIVE, or BANNED (also supports action: "lock" | "unlock").',
  })
  @ApiResponse({ status: 200, description: 'Customer status updated successfully' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCustomerStatusDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.customerService.updateStatus(id, dto, user);
    return {
      success: true,
      message: 'Customer status updated successfully',
      data,
    };
  }

  @Get(':id/orders')
  @ApiOperation({
    summary: 'Get customer order history',
    description: 'Retrieves all orders placed by the customer, including purchased items, medicines, and shipment status.',
  })
  @ApiResponse({ status: 200, description: 'Customer order history retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  async getCustomerOrders(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: CustomerOrderQueryDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const result = await this.customerService.getCustomerOrders(id, query, user);
    return {
      success: true,
      message: 'Customer order history retrieved successfully',
      data: result.items,
      pagination: result.pagination,
    };
  }
}
