import { Controller, Get, Patch, Post, Param, ParseIntPipe, Query, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { LogisticsService } from './logistics.service';
import { ShipmentQueryDto } from './dto/shipment-query.dto';
import { ReturnShipmentDto, ShipmentStatusDto } from './dto/shipment-status.dto';
import { ShipmentCarrierDto } from './dto/shipment-carrier.dto';
import { DeliveryProofDto, DeliveryDisputeDto } from './dto/delivery-proof.dto';
import { ReceiveReturnDto, ReturnDispositionDto, RequestPostDeliveryReturnDto } from './dto/return-intake-disposition.dto';
import { ReconcileCodDto } from './dto/cod-reconciliation.dto';
import { RecordRefundPaymentDto, ReturnRefundDto } from './dto/return-refund.dto';

@ApiTags('Admin - Logistics')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/logistics')
export class LogisticsController {
  constructor(private readonly logistics: LogisticsService) {}

  @Get('shipments')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'PHARMACIST', 'Pharmacist', 'WAREHOUSE_STAFF', 'WarehouseStaff')
  async shipments(@Query() query: ShipmentQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, ...await this.logistics.shipments(query, user) };
  }

  @Get('shipments/:id')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'PHARMACIST', 'Pharmacist', 'WAREHOUSE_STAFF', 'WarehouseStaff')
  async shipment(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.logistics.shipment(id, user) };
  }

  @Patch('shipments/:id/status')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'PHARMACIST', 'Pharmacist', 'WAREHOUSE_STAFF', 'WarehouseStaff')
  async updateShipment(@Param('id', ParseIntPipe) id: number, @Body() dto: ShipmentStatusDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.logistics.changeStatus(id, dto, user) };
  }

  @Patch('shipments/:id/carrier')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'PHARMACIST', 'Pharmacist')
  async updateCarrier(@Param('id', ParseIntPipe) id: number, @Body() dto: ShipmentCarrierDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.logistics.updateCarrier(id, dto, user) };
  }

  @Post('shipments/:id/delivery-proof')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'PHARMACIST', 'Pharmacist')
  async confirmDeliveryProof(@Param('id', ParseIntPipe) id: number, @Body() dto: DeliveryProofDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.logistics.confirmDeliveryWithProof(id, dto, user) };
  }

  @Post('shipments/:id/dispute')
  @Roles('CUSTOMER', 'Customer')
  async disputeDelivery(@Param('id', ParseIntPipe) id: number, @Body() dto: DeliveryDisputeDto, @CurrentUser() user: CurrentUserPayload) {
    return await this.logistics.disputeDelivery(id, user.id, dto.reason);
  }

  @Post('shipments/:id/return')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'PHARMACIST', 'Pharmacist')
  async returnShipment(@Param('id', ParseIntPipe) id: number, @Body() dto: ReturnShipmentDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.logistics.requestReturn(id, dto.reason, user) };
  }

  @Post('shipments/:id/post-delivery-return')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'PHARMACIST', 'Pharmacist')
  async postDeliveryReturn(@Param('id', ParseIntPipe) id: number, @Body() dto: RequestPostDeliveryReturnDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.logistics.requestPostDeliveryReturn(id, dto, user) };
  }

  @Post('shipments/:id/receive-return')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'WAREHOUSE_STAFF', 'WarehouseStaff')
  async receiveReturn(@Param('id', ParseIntPipe) id: number, @Body() dto: ReceiveReturnDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.logistics.receiveReturn(id, dto, user) };
  }

  @Post('shipments/:id/disposition-return')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'PHARMACIST', 'Pharmacist')
  async dispositionReturn(@Param('id', ParseIntPipe) id: number, @Body() dto: ReturnDispositionDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.logistics.dispositionReturn(id, dto, user) };
  }

  @Post('shipments/:id/refund')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager')
  async approveReturnRefund(@Param('id', ParseIntPipe) id: number, @Body() dto: ReturnRefundDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.logistics.approveReturnRefund(id, dto, user) };
  }

  @Post('shipments/:id/refund/payment')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager')
  async recordRefundPayment(@Param('id', ParseIntPipe) id: number, @Body() dto: RecordRefundPaymentDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.logistics.recordRefundPayment(id, dto, user) };
  }

  @Get('cod')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'ACCOUNTANT', 'FINANCE_MANAGER')
  async cod(@Query() query: ShipmentQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, ...await this.logistics.shipments(query, user, true) };
  }

  @Get('cod/:id')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'ACCOUNTANT', 'FINANCE_MANAGER')
  async codDetail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.logistics.shipment(id, user, true) };
  }

  @Post('cod/:id/reconcile')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'ACCOUNTANT', 'FINANCE_MANAGER')
  async reconcileCod(@Param('id', ParseIntPipe) id: number, @Body() dto: ReconcileCodDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.logistics.reconcileCod(id, dto, user) };
  }

  @Post('cod/:id/statements/:statementId/approve')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'FINANCE_MANAGER')
  async approveCodStatement(@Param('id', ParseIntPipe) id: number, @Param('statementId', ParseIntPipe) statementId: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.logistics.approveCodStatement(id, statementId, user) };
  }

  @Patch(':id/collect')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager')
  async collect(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.logistics.collect(id, user) };
  }
}
