import { Controller, Get, Patch, Param, ParseIntPipe, Query, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { InternalTransferService } from './internal-transfer.service';
import { DispatchTransferDto } from './dto/dispatch-transfer.dto';

@ApiTags('Admin - Logistics')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/logistics')
export class InternalTransferController {
  constructor(private readonly transfersService: InternalTransferService) {}

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
    return { success: true, data: await this.transfersService.adminDispatchInternalTransfer(id, dto.trackingCode, user) };
  }

  @Patch('transfers/:id/receive')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'WAREHOUSE_STAFF', 'WarehouseStaff')
  async receive(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.transfersService.adminReceiveInternalTransfer(id, user) };
  }

  @Patch('transfers/:id/reject-damaged')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'STORE_MANAGER', 'StoreManager', 'WAREHOUSE_STAFF', 'WarehouseStaff')
  async rejectDamaged(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.transfersService.adminRejectDamagedInternalTransfer(id, user) };
  }
}
