import { Controller, Get, Patch, Param, ParseIntPipe, Query, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { InternalTransferService } from './internal-transfer.service';
import { DispatchTransferDto } from './dto/dispatch-transfer.dto';
import { ReceiveTransferDto } from './dto/receive-transfer.dto';
import { ResolveDiscrepancyDto } from './dto/resolve-discrepancy.dto';
import { HaltTransferDto, RerouteTransferDto, ReceiveTransferReturnDto } from './dto/transfer-return.dto';

@ApiTags('Admin - Logistics')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/logistics')
export class InternalTransferController {
  constructor(private readonly transfersService: InternalTransferService) {}

  @Patch('transfers/:id/resolve-discrepancy')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager')
  async resolveDiscrepancy(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload, @Body() dto: ResolveDiscrepancyDto) {
    return { success: true, data: await this.transfersService.resolveDiscrepancy(id, dto, user) };
  }

  @Get('transfers')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'PHARMACIST', 'Pharmacist', 'WAREHOUSE_STAFF', 'WarehouseStaff')
  async transfers(@CurrentUser() user: CurrentUserPayload, @Query('orderId', new ParseIntPipe({ optional: true })) orderId?: number, @Query('status') status?: string) {
    const transfers = await this.transfersService.adminGetInternalTransfers(orderId, user, status);
    return { success: true, data: transfers };
  }

  @Get('transfers/:id')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'PHARMACIST', 'Pharmacist', 'WAREHOUSE_STAFF', 'WarehouseStaff')
  async transfer(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.transfersService.adminGetInternalTransfer(id, user) };
  }

  @Patch('transfers/:id/cancel')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'WAREHOUSE_STAFF', 'WarehouseStaff')
  async cancelTransfer(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.transfersService.cancelTransfer(id, user) };
  }

  @Patch('transfers/:id/dispatch')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'WAREHOUSE_STAFF', 'WarehouseStaff')
  async dispatch(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload, @Body() dto: DispatchTransferDto) {
    return { success: true, data: await this.transfersService.adminDispatchInternalTransfer(id, dto, user) };
  }

  @Get('transfers/:id/transport-staff')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'WAREHOUSE_STAFF', 'WarehouseStaff')
  async transportStaff(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.transfersService.transportStaff(id, user) };
  }

  @Patch('transfers/:id/halt')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'WAREHOUSE_STAFF', 'WarehouseStaff')
  async halt(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload, @Body() dto: HaltTransferDto) {
    return { success: true, data: await this.transfersService.adminHaltAndReturnTransfer(id, dto, user) };
  }

  @Patch('transfers/:id/reroute')
  @Roles('SUPER_ADMIN', 'SuperAdmin')
  async reroute(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload, @Body() dto: RerouteTransferDto) {
    return { success: true, data: await this.transfersService.adminRerouteTransfer(id, dto, user) };
  }

  @Patch('transfers/:id/receive')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'WAREHOUSE_STAFF', 'WarehouseStaff')
  async receive(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload, @Body() dto?: ReceiveTransferDto) {
    const data = dto !== undefined
      ? await this.transfersService.adminReceiveInternalTransfer(id, user, dto)
      : await this.transfersService.adminReceiveInternalTransfer(id, user);
    return { success: true, data };
  }

  @Patch('transfers/:id/receive-return')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'WAREHOUSE_STAFF', 'WarehouseStaff')
  async receiveReturn(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload, @Body() dto?: ReceiveTransferReturnDto) {
    return { success: true, data: await this.transfersService.adminReceiveTransferReturn(id, dto, user) };
  }

  @Patch('transfers/:id/reject-damaged')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'WAREHOUSE_STAFF', 'WarehouseStaff')
  async rejectDamaged(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.transfersService.adminRejectDamagedInternalTransfer(id, user) };
  }
}
