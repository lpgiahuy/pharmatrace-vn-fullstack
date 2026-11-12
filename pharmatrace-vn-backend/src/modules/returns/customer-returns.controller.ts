import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ChangeReturnMethodDto, CreateReturnDto, ReturnNoteDto, ReturnQueryDto } from './dto/return.dto';
import { ReturnsService } from './returns.service';

type Upload = { buffer: Buffer; mimetype: string; size: number };

@ApiTags('Customer - Returns (RMA)')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('customer')
export class CustomerReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get('orders/:orderId/return-eligibility')
  @ApiOperation({ summary: 'What can still be returned from this order, with allowed reasons and exchange options' })
  async eligibility(@Param('orderId', ParseIntPipe) orderId: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.eligibility({ id: orderId }, user) };
  }

  @Post('returns')
  @ApiOperation({ summary: 'Request a return (refund or exchange)' })
  async create(@Body() dto: CreateReturnDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.create(dto, user) };
  }

  @Get('returns')
  async list(@Query() query: ReturnQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, ...await this.returns.list(query, user) };
  }

  @Get('returns/:id')
  @ApiOperation({ summary: 'Return request with lines, handover info, timeline and refund' })
  async detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.detail(id, user) };
  }

  @Post('returns/:id/attachments')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } }))
  async addAttachment(@Param('id', ParseIntPipe) id: number, @UploadedFile() file: Upload | undefined, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.addAttachment(id, file, user) };
  }

  @Get('returns/:id/attachments/:attachmentId')
  async attachment(@Param('id', ParseIntPipe) id: number, @Param('attachmentId', ParseIntPipe) attachmentId: number, @CurrentUser() user: CurrentUserPayload) {
    return new StreamableFile(await this.returns.attachment(id, attachmentId, user), { type: 'image/webp', disposition: 'inline' });
  }

  @Put('returns/:id/return-method')
  async changeMethod(@Param('id', ParseIntPipe) id: number, @Body() dto: ChangeReturnMethodDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.changeMethod(id, dto, user) };
  }

  @Post('returns/:id/info')
  @ApiOperation({ summary: 'Answer a staff request for more information' })
  async provideInfo(@Param('id', ParseIntPipe) id: number, @Body() dto: ReturnNoteDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.provideInfo(id, dto.note, user) };
  }

  @Post('returns/:id/cancel')
  async cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.returns.cancel(id, user) };
  }
}
