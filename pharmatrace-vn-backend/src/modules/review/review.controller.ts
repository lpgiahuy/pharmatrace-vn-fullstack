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
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ReviewService } from './review.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReviewQueryDto } from './dto/review-query.dto';
import { CreateReportDto } from '../moderation/dto/create-report.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Reviews')
@Controller()
export class ReviewController {
  constructor(
    private readonly reviewService: ReviewService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  @Post('reviews/upload-image')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload feedback image for review' })
  async uploadReviewImage(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('No image file provided');
    }
    const uploaded = await this.cloudinaryService.uploadImage(file, 'pharmatrace/reviews');
    return {
      success: true,
      message: 'Image uploaded successfully',
      data: {
        imageUrl: uploaded.secure_url,
        publicId: uploaded.public_id,
      },
    };
  }

  @Get('products/:id/reviews')
  @ApiOperation({
    summary: 'Get paginated reviews for a product (Public)',
    description: 'Retrieves approved reviews, average score, star breakdown, and replies.',
  })
  @ApiResponse({ status: 200, description: 'Reviews retrieved successfully' })
  async getProductReviews(
    @Param('id') id: string,
    @Query() query: ReviewQueryDto,
  ) {
    const result = await this.reviewService.getProductReviews(id, query);
    return {
      success: true,
      message: 'Reviews retrieved successfully',
      data: result.items,
      stats: result.stats,
      pagination: result.pagination,
    };
  }

  @Get('products/:id/reviews/can-review')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Check if current customer can review product',
    description: 'Verifies delivered order purchase status and existing reviews.',
  })
  @ApiResponse({ status: 200, description: 'Checked successfully' })
  async checkCanReview(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const result = await this.reviewService.checkCanReview(id, user.id);
    return {
      success: true,
      data: result,
    };
  }

  @Post('products/:id/reviews')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Submit product review (Customer)',
    description: 'Allows a customer who received the product to submit a review with stars, comment, and images.',
  })
  @ApiResponse({ status: 201, description: 'Review submitted successfully' })
  async createReview(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateReviewDto,
  ) {
    const data = await this.reviewService.createProductReview(id, user.id, dto);
    return {
      success: true,
      message: 'Product review submitted successfully',
      data,
    };
  }

  @Post('reviews/:id/helpful')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Vote review as helpful or toggle unvote (Public)',
    description: 'Increments or decrements the helpful vote counter for a review.',
  })
  @ApiResponse({ status: 200, description: 'Voted successfully' })
  async voteHelpful(
    @Param('id', ParseIntPipe) id: number,
    @Body('isUnvote') isUnvote: boolean | undefined,
    @Req() req: any,
  ) {
    const rawIp =
      req.headers['x-forwarded-for'] ||
      req.connection?.remoteAddress ||
      req.socket?.remoteAddress ||
      'unknown-client';
    const clientIp = Array.isArray(rawIp) ? rawIp[0] : String(rawIp).split(',')[0].trim();
    const result = await this.reviewService.voteHelpful(id, Boolean(isUnvote), clientIp);
    return {
      success: true,
      message: isUnvote ? 'Helpful vote removed' : 'Thank you for your feedback!',
      data: result,
    };
  }

  @Post('reviews/:id/report')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Report review (Customer / Staff)',
    description: 'Allows an authenticated user to flag a review for spam, harassment, or policy violation.',
  })
  @ApiResponse({ status: 201, description: 'Review reported successfully' })
  async reportReview(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateReportDto,
  ) {
    const isEmployee = user.role && user.role !== 'CUSTOMER';
    const reporter = {
      customerId: !isEmployee ? user.id : undefined,
      employeeId: isEmployee ? user.id : undefined,
      role: user.role || (isEmployee ? 'EMPLOYEE' : 'CUSTOMER'),
    };
    return this.reviewService.reportReview(id, reporter, dto);
  }

  @Get('customer/my-reviews')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get customer review history',
    description: 'Retrieves all reviews submitted by the current authenticated customer.',
  })
  @ApiResponse({ status: 200, description: 'Customer reviews retrieved' })
  async getCustomerMyReviews(
    @CurrentUser() user: CurrentUserPayload,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const result = await this.reviewService.getCustomerMyReviews(user.id, {
      page,
      limit,
    });
    return {
      success: true,
      data: result.items,
      pagination: result.pagination,
    };
  }

  @Get('customer/pending-reviews')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get customer pending products waiting for review',
    description: 'Retrieves purchased and delivered medicines that customer has not yet reviewed.',
  })
  @ApiResponse({ status: 200, description: 'Pending reviews retrieved' })
  async getCustomerPendingReviews(@CurrentUser() user: CurrentUserPayload) {
    const result = await this.reviewService.getCustomerPendingReviews(user.id);
    return {
      success: true,
      data: result.items,
    };
  }

  @Patch('customer/reviews/:id')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Edit customer review (Customer)',
    description: 'Allows a customer to edit their own existing review.',
  })
  @ApiResponse({ status: 200, description: 'Review updated successfully' })
  async updateCustomerReview(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdateReviewDto,
  ) {
    const data = await this.reviewService.customerUpdateReview(id, user.id, dto);
    return {
      success: true,
      message: 'Review updated successfully',
      data,
    };
  }

  @Delete('customer/reviews/:id')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Delete customer review (Customer)',
    description: 'Allows a customer to delete their own review, freeing up the product for a new review.',
  })
  @ApiResponse({ status: 200, description: 'Review deleted successfully' })
  async deleteCustomerReview(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const result = await this.reviewService.customerDeleteReview(id, user.id);
    return result;
  }
}
