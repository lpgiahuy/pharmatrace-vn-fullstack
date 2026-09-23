import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ReviewService } from './review.service';
import { AdminReviewQueryDto } from './dto/admin-review-query.dto';
import { UpdateReviewStatusDto } from './dto/update-review-status.dto';
import { ReplyReviewDto } from './dto/reply-review.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Admin - Reviews Moderation')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  'SUPER_ADMIN',
  'SuperAdmin',
  'STORE_MANAGER',
  'StoreManager',
  'SALES_STAFF',
  'SalesStaff',
  'PHARMACIST',
  'Pharmacist',
)
@Controller('admin/reviews')
export class AdminReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Get()
  @ApiOperation({
    summary: 'Get all reviews for moderation (Admin)',
    description: 'Lists all reviews with filtering by status (APPROVED, PENDING, HIDDEN, SPAM), rating, and search.',
  })
  @ApiResponse({ status: 200, description: 'Reviews retrieved successfully' })
  async getAllReviews(@Query() query: AdminReviewQueryDto) {
    const result = await this.reviewService.getAllReviewsForAdmin(query);
    return {
      success: true,
      data: result.items,
      pagination: result.pagination,
    };
  }

  @Patch(':id/status')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'ADMIN', 'Admin')
  @ApiOperation({
    summary: 'Update review moderation status (SuperAdmin)',
    description: 'Approve, hide, or mark review as spam.',
  })
  @ApiResponse({ status: 200, description: 'Status updated successfully' })
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
    @Body() dto: UpdateReviewStatusDto,
  ) {
    const adminId = user.userId || user.id;
    const adminRole = user.role || 'SUPER_ADMIN';
    return this.reviewService.updateReviewStatus(
      id,
      dto.status,
      adminId,
      adminRole,
      dto.reason,
    );
  }

  @Post(':id/reply')
  @ApiOperation({
    summary: 'Reply to customer review (Admin / Pharmacist)',
    description: 'Allows staff or pharmacists to reply with medical advice or customer service.',
  })
  @ApiResponse({ status: 200, description: 'Replied successfully' })
  async replyToReview(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
    @Body() dto: ReplyReviewDto,
  ) {
    const adminName = user.fullName || user.name || 'Dược sĩ PharmaTrace';
    const adminId = user.userId || user.id;
    const adminRole = user.role || 'PHARMACIST';
    return this.reviewService.replyToReview(id, dto, adminName, adminId, adminRole);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'ADMIN', 'Admin')
  @ApiOperation({
    summary: 'Delete review permanently (SuperAdmin)',
  })
  @ApiResponse({ status: 200, description: 'Deleted review' })
  async deleteReview(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    const adminId = user.userId || user.id;
    const adminRole = user.role || 'SUPER_ADMIN';
    return this.reviewService.deleteReview(id, adminId, adminRole);
  }
}
