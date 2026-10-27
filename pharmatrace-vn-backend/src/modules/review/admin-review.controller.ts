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
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Admin - Reviews Moderation')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  'SUPER_ADMIN',
  'SuperAdmin',
  'ADMIN',
  'Admin',
  'STORE_MANAGER',
  'StoreManager',
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
  async getAllReviews(@Query() query: AdminReviewQueryDto, @CurrentUser() user: CurrentUserPayload) {
    const result = await this.reviewService.getAllReviewsForAdmin(query, user);
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
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdateReviewStatusDto,
  ) {
    const adminRole = user.role || '';
    return this.reviewService.updateReviewStatus(
      id,
      dto.status,
      user.id,
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
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ReplyReviewDto,
  ) {
    const adminName = (user.fullName as string) || (user.name as string) || 'PharmaTrace Pharmacist';
    const adminRole = user.role || '';
    return this.reviewService.replyToReview(id, dto, adminName, user.id, adminRole);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'SuperAdmin', 'ADMIN', 'Admin')
  @ApiOperation({
    summary: 'Delete review permanently (SuperAdmin)',
  })
  @ApiResponse({ status: 200, description: 'Deleted review' })
  async deleteReview(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const adminRole = user.role || '';
    return this.reviewService.deleteReview(id, user.id, adminRole);
  }
}
