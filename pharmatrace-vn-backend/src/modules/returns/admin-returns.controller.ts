import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  ApproveReturnDto, InspectReturnDto, ReceiveReturnDto, ReturnCarrierDto, ReturnNoteDto, ReturnQueryDto, ReturnRefundDto,
  ReturnRefundPaymentDto, StaffCreateReturnDto,
} from './dto/return.dto';
import { ReturnsService } from './returns.service';

type Upload = { buffer: Buffer; mimetype: string; size: number };
const STAFF = ['SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST', 'WAREHOUSE_STAFF'];
const REVIEWERS = ['SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST'];
const RECEIVERS = ['SUPER_ADMIN', 'STORE_MANAGER', 'WAREHOUSE_STAFF'];
const MANAGERS = ['SUPER_ADMIN', 'STORE_MANAGER'];

@ApiTags('Admin - Returns (RMA)')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/returns')
export class AdminReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  @Roles(...STAFF)
  async list(@Query() query: ReturnQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, ...await this.returns.list(query, user) };
  }

  @Get('lookup')
  @Roles(...REVIEWERS)
  @ApiOperation({ summary: 'Find an order by its code (counter returns) and show what can be returned' })
  async lookup(@Query('orderCode') orderCode = '', @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.eligibility({ order_code: orderCode.trim() }, user) };
  }

  @Post()
  @Roles(...REVIEWERS)
  @ApiOperation({ summary: 'Record a return on behalf of a customer (at the counter or by phone)' })
  async create(@Body() dto: StaffCreateReturnDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.create(dto, user) };
  }

  @Get(':id')
  @Roles(...STAFF)
  async detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.detail(id, user) };
  }

  @Post(':id/attachments')
  @Roles(...STAFF)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } }))
  async addAttachment(@Param('id', ParseIntPipe) id: number, @UploadedFile() file: Upload | undefined, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.addAttachment(id, file, user) };
  }

  @Get(':id/attachments/:attachmentId')
  @Roles(...STAFF)
  async attachment(@Param('id', ParseIntPipe) id: number, @Param('attachmentId', ParseIntPipe) attachmentId: number, @CurrentUser() user: CurrentUserPayload) {
    return new StreamableFile(await this.returns.attachment(id, attachmentId, user), { type: 'image/webp', disposition: 'inline' });
  }

  @Post(':id/approve')
  @Roles(...REVIEWERS)
  async approve(@Param('id', ParseIntPipe) id: number, @Body() dto: ApproveReturnDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.approve(id, dto, user) };
  }

  @Post(':id/reject')
  @Roles(...REVIEWERS)
  async reject(@Param('id', ParseIntPipe) id: number, @Body() dto: ReturnNoteDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.reject(id, dto.note, user) };
  }

  @Post(':id/reject-receipt')
  @Roles(...STAFF)
  @ApiOperation({ summary: 'Refuse the parcel because it does not match the approved goods; the request is rejected' })
  async rejectReceipt(@Param('id', ParseIntPipe) id: number, @Body() dto: ReturnNoteDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.rejectReceipt(id, dto.note, user) };
  }

  @Post(':id/request-info')
  @Roles(...REVIEWERS)
  async requestInfo(@Param('id', ParseIntPipe) id: number, @Body() dto: ReturnNoteDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.requestInfo(id, dto.note, user) };
  }

  @Post(':id/carrier')
  @Roles(...REVIEWERS)
  @ApiOperation({ summary: 'Record the courier booked to pick up the goods' })
  async setCarrier(@Param('id', ParseIntPipe) id: number, @Body() dto: ReturnCarrierDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.setCarrier(id, dto, user) };
  }

  @Post(':id/receive')
  @Roles(...RECEIVERS)
  async receive(@Param('id', ParseIntPipe) id: number, @Body() dto: ReceiveReturnDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.receive(id, dto, user) };
  }

  @Post(':id/inspection')
  @Roles(...REVIEWERS)
  async inspect(@Param('id', ParseIntPipe) id: number, @Body() dto: InspectReturnDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.inspect(id, dto, user) };
  }

  @Post(':id/exchange')
  @Roles(...REVIEWERS)
  @ApiOperation({ summary: 'Create the replacement order for an exchange' })
  async exchange(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.createExchangeOrder(id, user) };
  }

  @Post(':id/refund')
  @Roles(...MANAGERS)
  async approveRefund(@Param('id', ParseIntPipe) id: number, @Body() dto: ReturnRefundDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.approveRefund(id, dto, user) };
  }

  @Post(':id/refund/payment')
  @Roles(...MANAGERS)
  async recordRefundPayment(@Param('id', ParseIntPipe) id: number, @Body() dto: ReturnRefundPaymentDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.recordRefundPayment(id, dto, user) };
  }

  @Post(':id/close')
  @Roles(...MANAGERS)
  async close(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.close(id, user) };
  }
}
