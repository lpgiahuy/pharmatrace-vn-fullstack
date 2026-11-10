import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Customer - Orders')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) { }

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  async quoteOrder(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateOrderDto) {
    return { success: true, data: await this.orderService.createOrder(user.id, dto, true) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Place order from shopping cart or selected items',
    description:
      'Creates a new order, applies optional voucher code, redeems reward points, snapshots pricing, and creates line items.',
  })
  @ApiResponse({ status: 201, description: 'Order created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid cart, voucher, or prescription requirements' })
  async createOrder(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateOrderDto) {
    const order = await this.orderService.createOrder(user.id, dto);
    return {
      success: true,
      message: 'Order placed successfully',
      data: order,
    };
  }

  @Get('me')
  @ApiOperation({
    summary: 'Get paginated order history for current customer',
    description: 'Retrieves customer orders with status filtering and pagination.',
  })
  @ApiResponse({ status: 200, description: 'Orders retrieved successfully' })
  async getMyOrders(@CurrentUser() user: CurrentUserPayload, @Query() query: OrderQueryDto) {
    const result = await this.orderService.getMyOrders(user.id, query);
    return {
      success: true,
      message: 'Orders retrieved successfully',
      data: result.items,
      pagination: result.pagination,
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get single order details by ID',
    description: 'Returns full details of an order including line items, shipment, and pricing breakdown.',
  })
  @ApiResponse({ status: 200, description: 'Order details retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Access denied to this order' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async getMyOrderById(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseIntPipe) orderId: number,
  ) {
    const order = await this.orderService.getMyOrderById(user.id, orderId);
    return {
      success: true,
      message: 'Order retrieved successfully',
      data: order,
    };
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a pending order',
    description: 'Cancels order if current status is PENDING and refunds used reward points.',
  })
  @ApiResponse({ status: 200, description: 'Order cancelled successfully' })
  @ApiResponse({ status: 400, description: 'Order cannot be cancelled in its current state' })
  async cancelMyOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseIntPipe) orderId: number,
    @Body() dto: CancelOrderDto,
  ) {
    const order = await this.orderService.cancelMyOrder(user.id, orderId, dto);
    return {
      success: true,
      message: 'Order cancelled successfully',
      data: order,
    };
  }

}
