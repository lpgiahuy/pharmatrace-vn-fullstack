import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { AdminOrderService } from "./admin-order.service";
import { OrderCronService } from "./order-cron.service";
import { OrderQueryDto } from "./dto/order-query.dto";
import { UpdateOrderStatusDto } from "./dto/update-order-status.dto";
import { PackOrderDto } from "./dto/pack-order.dto";
import { OnlinePaymentDto, RejectOnlinePaymentDto, PaymentExceptionDto, ResolvePaymentExceptionDto } from "./dto/online-payment.dto";
import { FulfillmentPolicyDto, TransportRequirementDto, WarehouseSellingPharmaciesDto } from './dto/fulfillment-policy.dto';
import { ApproveCancellationRefundDto, RecordCancellationRefundDto, ResolveDeliveryDisputeDto } from './dto/order-resolution.dto';
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  CurrentUserPayload,
} from "../../common/decorators/current-user.decorator";

@ApiTags("Admin - Orders")
@ApiBearerAuth("bearerAuth")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("admin/orders")
export class AdminOrderController {
  constructor(
    private readonly orderService: AdminOrderService,
    private readonly orderCronService: OrderCronService,
  ) {}

  @Get(':id/resolution')
  @Roles('SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST', 'WAREHOUSE_STAFF', 'ACCOUNTANT', 'FINANCE_MANAGER')
  async resolution(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.orderService.getOrderResolution(id, user) };
  }

  @Post(':id/dispute/resolve')
  @Roles('SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST')
  async resolveDispute(@Param('id', ParseIntPipe) id: number, @Body() dto: ResolveDeliveryDisputeDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.orderService.resolveDeliveryDispute(id, dto, user) };
  }

  @Post(':id/cancellation-refund/approve')
  @Roles('SUPER_ADMIN', 'FINANCE_MANAGER')
  async approveCancellationRefund(@Param('id', ParseIntPipe) id: number, @Body() dto: ApproveCancellationRefundDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.orderService.approveCancellationRefund(id, dto, user) };
  }

  @Post(':id/cancellation-refund/payment')
  @Roles('SUPER_ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async recordCancellationRefund(@Param('id', ParseIntPipe) id: number, @Body() dto: RecordCancellationRefundDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.orderService.recordCancellationRefund(id, dto, user) };
  }

  @Get('fulfillment/policies')
  @Roles('SUPER_ADMIN', 'STORE_MANAGER')
  async fulfillmentPolicies(@CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.orderService.getFulfillmentPolicies(user) };
  }

  @Post('fulfillment/facilities/:facilityId')
  @Roles('SUPER_ADMIN', 'STORE_MANAGER')
  async saveFulfillmentPolicy(@Param('facilityId', ParseIntPipe) id: number, @Body() dto: FulfillmentPolicyDto, @CurrentUser() user: CurrentUserPayload) {
    await this.orderService.saveFulfillmentPolicy(id, dto, user);
    return { success: true };
  }

  @Post('fulfillment/medicines/:medicineId')
  @Roles('SUPER_ADMIN')
  async saveTransportRequirement(@Param('medicineId', ParseIntPipe) id: number, @Body() dto: TransportRequirementDto, @CurrentUser() user: CurrentUserPayload) {
    await this.orderService.saveTransportRequirement(id, dto.condition, user);
    return { success: true };
  }

  @Post('fulfillment/warehouses/:facilityId/selling-pharmacies')
  @Roles('SUPER_ADMIN')
  async setWarehouseSellingPharmacies(@Param('facilityId', ParseIntPipe) id: number, @Body() dto: WarehouseSellingPharmaciesDto, @CurrentUser() user: CurrentUserPayload) {
    await this.orderService.setWarehouseSellingPharmacies(id, dto.pharmacyIds, user);
    return { success: true };
  }

  @Get(':id/payment-exceptions')
  @Roles('SUPER_ADMIN', 'ACCOUNTANT', 'FINANCE_MANAGER')
  async paymentExceptions(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.orderService.getPaymentExceptions(id, user) };
  }

  @Post(':id/payment-exceptions')
  @Roles('SUPER_ADMIN', 'ACCOUNTANT', 'FINANCE_MANAGER')
  async recordPaymentException(@Param('id', ParseIntPipe) id: number, @Body() dto: PaymentExceptionDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.orderService.recordPaymentException(id, dto, user) };
  }

  @Post(':id/payment-exceptions/:receiptId/resolve')
  @Roles('SUPER_ADMIN', 'FINANCE_MANAGER')
  async resolvePaymentException(@Param('id', ParseIntPipe) id: number, @Param('receiptId', ParseIntPipe) receiptId: number, @Body() dto: ResolvePaymentExceptionDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.orderService.resolvePaymentException(id, receiptId, dto, user) };
  }

  @Get()
  @Roles(
    "SUPER_ADMIN",
    "SuperAdmin",
    "STORE_MANAGER",
    "StoreManager",
    "PHARMACIST",
    "Pharmacist",
    "WAREHOUSE_STAFF",
    "WarehouseStaff",
    "ACCOUNTANT",
    "FINANCE_MANAGER",
  )
  @ApiOperation({
    summary: "List all orders with status, search and pagination (Admin)",
    description:
      "Returns all customer orders with customer info, shipment, and line items summary.",
  })
  @ApiResponse({ status: 200, description: "Orders retrieved successfully" })
  async getAllOrders(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: OrderQueryDto,
  ) {
    const result = await this.orderService.adminGetAllOrders(query, user);
    return {
      success: true,
      message: "Orders retrieved successfully",
      data: result.items,
      pagination: result.pagination,
    };
  }

  @Get(":id")
  @Roles(
    "SUPER_ADMIN",
    "SuperAdmin",
    "STORE_MANAGER",
    "StoreManager",
    "PHARMACIST",
    "Pharmacist",
    "WAREHOUSE_STAFF",
    "WarehouseStaff",
    "ACCOUNTANT",
    "FINANCE_MANAGER",
  )
  @ApiOperation({ summary: "Get full order details by ID (Admin)" })
  @ApiResponse({
    status: 200,
    description: "Order details retrieved successfully",
  })
  @ApiResponse({ status: 404, description: "Order not found" })
  async getOrderById(
    @CurrentUser() user: CurrentUserPayload,
    @Param("id", ParseIntPipe) id: number,
  ) {
    const order = await this.orderService.adminGetOrderById(id, user);
    return {
      success: true,
      message: "Order details retrieved successfully",
      data: order,
    };
  }

  @Get(':id/payments')
  @Roles('SUPER_ADMIN', 'ACCOUNTANT', 'FINANCE_MANAGER')
  async getOnlinePayments(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.orderService.getOnlinePayments(id, user) };
  }

  @Post(':id/payments')
  @Roles('SUPER_ADMIN', 'ACCOUNTANT', 'FINANCE_MANAGER')
  async submitOnlinePayment(@Param('id', ParseIntPipe) id: number, @Body() dto: OnlinePaymentDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.orderService.submitOnlinePayment(id, dto, user) };
  }

  @Post(':id/payments/:paymentId/approve')
  @Roles('SUPER_ADMIN', 'FINANCE_MANAGER')
  async approveOnlinePayment(@Param('id', ParseIntPipe) id: number, @Param('paymentId', ParseIntPipe) paymentId: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.orderService.approveOnlinePayment(id, paymentId, user) };
  }

  @Post(':id/payments/:paymentId/reject')
  @Roles('SUPER_ADMIN', 'FINANCE_MANAGER')
  async rejectOnlinePayment(@Param('id', ParseIntPipe) id: number, @Param('paymentId', ParseIntPipe) paymentId: number, @Body() dto: RejectOnlinePaymentDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.orderService.rejectOnlinePayment(id, paymentId, dto.reason, user) };
  }

  @Patch(":id/status")
  @Roles(
    "SUPER_ADMIN",
    "SuperAdmin",
    "STORE_MANAGER",
    "StoreManager",
    "PHARMACIST",
    "Pharmacist",
  )
  @ApiOperation({
    summary: "Update order status with state machine enforcement (Admin)",
    description:
      "Enforces transitions like PENDING -> PROCESSING -> SHIPPING -> COMPLETED.",
  })
  @ApiResponse({
    status: 200,
    description: "Order status updated successfully",
  })
  @ApiResponse({ status: 400, description: "Invalid status transition" })
  async updateOrderStatus(
    @CurrentUser() user: CurrentUserPayload,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    const order = await this.orderService.adminUpdateOrderStatus(id, dto, user);
    return {
      success: true,
      message: `Order status updated to ${dto.orderStatus}`,
      data: order,
    };
  }

  @Get(":id/available-boxes")
  @Roles(
    "SUPER_ADMIN",
    "SuperAdmin",
    "STORE_MANAGER",
    "StoreManager",
    "PHARMACIST",
    "Pharmacist",
    "WAREHOUSE_STAFF",
    "WarehouseStaff",
  )
  @ApiOperation({
    summary: "Get available in-stock medicine boxes for order packing (Admin)",
    description:
      "Retrieves in-stock physical serialized box UIDs matching medicines in the order sorted by FEFO.",
  })
  @ApiResponse({
    status: 200,
    description: "Available medicine boxes retrieved successfully",
  })
  async getAvailableBoxes(
    @CurrentUser() user: CurrentUserPayload,
    @Param("id", ParseIntPipe) id: number,
  ) {
    const boxes = await this.orderService.adminGetAvailableBoxesForOrder(
      id,
      user,
    );
    return {
      success: true,
      message: "Available medicine boxes retrieved successfully",
      data: boxes,
    };
  }

  @Post(":id/pack")
  @HttpCode(HttpStatus.OK)
  @Roles(
    "SUPER_ADMIN",
    "SuperAdmin",
    "STORE_MANAGER",
    "StoreManager",
    "PHARMACIST",
    "Pharmacist",
    "WAREHOUSE_STAFF",
    "WarehouseStaff",
  )
  @ApiOperation({
    summary: "Pack order and dispatch shipment (Warehouse / Admin)",
    description:
      "Validates the medicine box UIDs reserved when the order was created, updates box status to PACKAGED, adjusts inventory balances, and generates shipment tracking number.",
  })
  @ApiResponse({
    status: 200,
    description: "Order packed and shipment created",
  })
  @ApiResponse({
    status: 400,
    description:
      "Order is not in packable status, invalid UIDs, or already packed",
  })
  async packOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto?: PackOrderDto,
  ) {
    const order = await this.orderService.adminPackOrder(id, dto, user);
    return {
      success: true,
      message: "Order packed and shipment dispatched successfully",
      data: order,
    };
  }

  @Post("trigger-point-award")
  @HttpCode(HttpStatus.OK)
  @Roles("SUPER_ADMIN", "SuperAdmin")
  @ApiOperation({
    summary: "Manually trigger loyalty points award cron (Admin)",
    description:
      "Scans eligible completed orders after the configured return window.",
  })
  @ApiResponse({
    status: 200,
    description: "Points award process executed successfully",
  })
  async triggerPointAward() {
    const result = await this.orderCronService.awardPointsForCompletedOrders();
    return {
      success: true,
      message: `Point award task completed. Awarded points for ${result.awardedCount} order(s).`,
      data: result,
    };
  }
}
