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
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'PHARMACIST', 'Pharmacist')
  async updateShipment(@Param('id', ParseIntPipe) id: number, @Body() dto: ShipmentStatusDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.logistics.changeStatus(id, dto, user) };
  }

  @Patch('shipments/:id/carrier')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'PHARMACIST', 'Pharmacist')
  async updateCarrier(@Param('id', ParseIntPipe) id: number, @Body() dto: ShipmentCarrierDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.logistics.updateCarrier(id, dto, user) };
  }

  @Post('shipments/:id/return')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'PHARMACIST', 'Pharmacist')
  async returnShipment(@Param('id', ParseIntPipe) id: number, @Body() dto: ReturnShipmentDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.logistics.requestReturn(id, dto.reason, user) };
  }

  @Get('cod')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager')
  async cod(@Query() query: ShipmentQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, ...await this.logistics.shipments(query, user, true) };
  }

  @Get('cod/:id')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager')
  async codDetail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.logistics.shipment(id, user, true) };
  }

  @Patch(':id/collect')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager')
  async collect(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.logistics.collect(id, user) };
  }

}
