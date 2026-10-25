import {
  ForbiddenException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrescriptionService } from './prescription.service';
import { ReviewDecisionDto } from './dto/review-decision.dto';

@ApiTags('Prescriptions')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard)
@Controller()
export class PrescriptionController {
  constructor(private readonly prescriptions: PrescriptionService) { }

  private customerId(user: CurrentUserPayload) {
    if (user.type !== 'customer' || user.role !== 'CUSTOMER') {
      throw new ForbiddenException('A customer account is required');
    }
    return user.id;
  }

  @Post('prescriptions')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a customer prescription image' })
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 },
  }))
  async upload(@CurrentUser() user: CurrentUserPayload, @UploadedFile() file?: { buffer: Buffer; mimetype: string; size: number }) {
    return { success: true, data: await this.prescriptions.uploadPrescription(this.customerId(user), file) };
  }

  @Get('prescriptions')
  @ApiOperation({ summary: 'List prescriptions belonging to the current customer' })
  async getMyPrescriptions(@CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.prescriptions.getMyPrescriptions(this.customerId(user)) };
  }

  @Get('prescriptions/:id/image')
  @ApiOperation({ summary: 'Read a customer prescription image' })
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async getCustomerPrescriptionImage(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseIntPipe) id: number) {
    const file = await this.prescriptions.getCustomerPrescriptionImage(this.customerId(user), id);
    return new StreamableFile(file.image, { type: file.contentType, disposition: 'inline' });
  }

  @Get('admin/prescriptions')
  @ApiOperation({ summary: 'List prescription reviews for the preparing facility' })
  async getReviewQueue(
    @CurrentUser() user: CurrentUserPayload,
    @Query('status') status = 'PENDING_APPROVAL',
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return { success: true, data: await this.prescriptions.getReviewQueue(user, status, page, limit) };
  }

  @Get('admin/prescriptions/:id/image')
  @ApiOperation({ summary: 'Read a prescription image for an assigned order' })
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async getReviewPrescriptionImage(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseIntPipe) id: number) {
    const file = await this.prescriptions.getReviewPrescriptionImage(user, id);
    return new StreamableFile(file.image, { type: file.contentType, disposition: 'inline' });
  }

  @Patch('admin/prescriptions/:id/approve')
  @ApiOperation({ summary: 'Approve a prescription for one order' })
  async approve(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: ReviewDecisionDto) {
    return { success: true, data: await this.prescriptions.decidePrescriptionReview(user, id, 'APPROVED', dto?.note) };
  }

  @Patch('admin/prescriptions/:id/reject')
  @ApiOperation({ summary: 'Reject a prescription and cancel the order' })
  async reject(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: ReviewDecisionDto) {
    return { success: true, data: await this.prescriptions.decidePrescriptionReview(user, id, 'REJECTED', dto?.note) };
  }
}
