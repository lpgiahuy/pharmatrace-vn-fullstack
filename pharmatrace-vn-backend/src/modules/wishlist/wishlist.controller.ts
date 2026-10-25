import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  ParseIntPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { WishlistService } from './wishlist.service';
import { WishlistQueryDto } from './dto/wishlist-query.dto';
import { CheckBatchWishlistDto } from './dto/check-batch-wishlist.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Customer - Wishlist')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('customer/wishlist')
export class WishlistController {
  constructor(private readonly wishlistService: WishlistService) {}

  @Get()
  @ApiOperation({
    summary: 'Get paginated customer wishlist items',
    description: 'Retrieves all medicines saved in customer wishlist with pagination, search, and sorting.',
  })
  @ApiResponse({ status: 200, description: 'Wishlist items retrieved successfully' })
  async getWishlist(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: WishlistQueryDto,
  ) {
    const result = await this.wishlistService.getWishlist(user.id, query);
    return {
      success: true,
      message: 'Wishlist retrieved successfully',
      data: result.items,
      pagination: result.pagination,
    };
  }

  @Get('check/:productId')
  @ApiOperation({
    summary: 'Check if single product is wishlisted',
    description: 'Quickly checks if a product is saved in the authenticated customer wishlist.',
  })
  @ApiResponse({ status: 200, description: 'Checked successfully' })
  async checkIsWishlisted(
    @CurrentUser() user: CurrentUserPayload,
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    const result = await this.wishlistService.checkIsWishlisted(user.id, productId);
    return {
      success: true,
      data: result,
    };
  }

  @Post('check-batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Batch check products in wishlist',
    description: 'Returns array of wishlisted product IDs for a given list of product IDs.',
  })
  @ApiResponse({ status: 200, description: 'Batch checked successfully' })
  async checkBatchWishlist(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CheckBatchWishlistDto,
  ) {
    const result = await this.wishlistService.checkBatchWishlist(user.id, dto.productIds);
    return {
      success: true,
      data: result,
    };
  }

  @Post(':productId')
  @ApiOperation({
    summary: 'Add medicine to wishlist',
    description: 'Saves a medicine to the authenticated customer wishlist.',
  })
  @ApiResponse({ status: 201, description: 'Added to wishlist successfully' })
  async addToWishlist(
    @CurrentUser() user: CurrentUserPayload,
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    const result = await this.wishlistService.addToWishlist(user.id, productId);
    return {
      success: true,
      message: result.message,
      data: result,
    };
  }

  @Delete(':productId')
  @ApiOperation({
    summary: 'Remove medicine from wishlist',
    description: 'Removes a medicine from the authenticated customer wishlist.',
  })
  @ApiResponse({ status: 200, description: 'Removed from wishlist successfully' })
  async removeFromWishlist(
    @CurrentUser() user: CurrentUserPayload,
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    const result = await this.wishlistService.removeFromWishlist(user.id, productId);
    return {
      success: true,
      message: result.message,
      data: result,
    };
  }
}
