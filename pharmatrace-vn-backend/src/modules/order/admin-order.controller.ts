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
    "SALES_STAFF",
    "SalesStaff",
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

  @Get("transfers/all")
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
    summary: "List all inter-facility warehouse transfers (Admin / WMS)",
  })
  async getAllInternalTransfers(
    @CurrentUser() user: CurrentUserPayload,
    @Query("orderId") orderId?: string,
  ) {
    const id = orderId ? Number(orderId) : undefined;
    const transfers = await this.orderService.adminGetInternalTransfers(
      id,
      user,
    );
    return {
      success: true,
      message: "Internal transfers retrieved successfully",
      data: transfers,
    };
  }

  @Patch("transfers/:transferId/dispatch")
  @Roles(
    "SUPER_ADMIN",
    "SuperAdmin",
    "STORE_MANAGER",
    "StoreManager",
    "WAREHOUSE_STAFF",
    "WarehouseStaff",
  )
  @ApiOperation({
    summary: "Mark internal transfer as dispatched from source warehouse",
  })
  async dispatchInternalTransfer(
    @CurrentUser() user: CurrentUserPayload,
    @Param("transferId", ParseIntPipe) transferId: number,
    @Body("trackingCode") trackingCode?: string,
  ) {
    const transfer = await this.orderService.adminDispatchInternalTransfer(
      transferId,
      trackingCode,
      user,
    );
    return {
      success: true,
      message: "Internal transfer dispatched successfully",
      data: transfer,
    };
  }

  @Patch("transfers/:transferId/receive")
  @Roles(
    "SUPER_ADMIN",
    "SuperAdmin",
    "STORE_MANAGER",
    "StoreManager",
    "WAREHOUSE_STAFF",
    "WarehouseStaff",
  )
  @ApiOperation({
    summary:
      "Inspect and receive internal transfer at destination warehouse, updating stock and auto-progressing order",
  })
  async receiveInternalTransfer(
    @CurrentUser() user: CurrentUserPayload,
    @Param("transferId", ParseIntPipe) transferId: number,
  ) {
    const transfer = await this.orderService.adminReceiveInternalTransfer(
      transferId,
      user,
    );
    return {
      success: true,
      message:
        "Internal transfer received and verified at destination facility. Order state updated.",
      data: transfer,
    };
  }

  @Patch("transfers/:transferId/reject-damaged")
  @Roles(
    "SUPER_ADMIN",
    "SuperAdmin",
    "STORE_MANAGER",
    "StoreManager",
    "WAREHOUSE_STAFF",
    "WarehouseStaff",
  )
  @ApiOperation({ summary: "Reject damaged transfer and reserve replacement stock" })
  async rejectDamagedInternalTransfer(
    @CurrentUser() user: CurrentUserPayload,
    @Param("transferId", ParseIntPipe) transferId: number,
  ) {
    const replacement = await this.orderService.adminRejectDamagedInternalTransfer(transferId, user);
    const replacementCreated = replacement.status === "REQUESTED";
    return {
      success: true,
      message: replacementCreated
        ? "Damaged transfer rejected and replacement transfer created"
        : "Damaged transfer recorded; manual replacement or order cancellation is required",
      data: replacement,
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
    "SALES_STAFF",
    "SalesStaff",
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
      "Scans completed orders and awards points for orders older than the return window (default 7 days). Pass ?days=0 for instant testing.",
  })
  @ApiResponse({
    status: 200,
    description: "Points award process executed successfully",
  })
  async triggerPointAward(@Query("days") days?: string) {
    const returnDays = days !== undefined ? Number(days) : undefined;
    const result =
      await this.orderCronService.awardPointsForCompletedOrders(returnDays);
    return {
      success: true,
      message: `Point award task completed. Awarded points for ${result.awardedCount} order(s).`,
      data: result,
    };
  }
}
