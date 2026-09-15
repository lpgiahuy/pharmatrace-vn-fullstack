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
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Customer - Wishlist')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard)
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
    @CurrentUser() user: any,
    @Query() query: WishlistQueryDto,
  ) {
    const customerId = user.userId || user.id;
    const result = await this.wishlistService.getWishlist(customerId, query);
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
    @CurrentUser() user: any,
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    const customerId = user.userId || user.id;
    const result = await this.wishlistService.checkIsWishlisted(customerId, productId);
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
    @CurrentUser() user: any,
    @Body() dto: CheckBatchWishlistDto,
  ) {
    const customerId = user.userId || user.id;
    const result = await this.wishlistService.checkBatchWishlist(customerId, dto.productIds);
    return {
      success: true,
      data: result,
    };
  }

  @Post(':productId/move-to-cart')
  @ApiOperation({
    summary: 'Move product from wishlist to cart',
    description: 'Removes medicine from wishlist and returns item data ready for cart insertion.',
  })
  @ApiResponse({ status: 200, description: 'Moved to cart successfully' })
  async moveToCart(
    @CurrentUser() user: any,
    @Param('productId', ParseIntPipe) productId: number,
    @Body('variantId') variantId?: number,
  ) {
    const customerId = user.userId || user.id;
    const result = await this.wishlistService.moveToCart(customerId, productId, variantId);
    return {
      success: true,
      message: result.message,
      data: result.item,
    };
  }

  @Post(':productId')
  @ApiOperation({
    summary: 'Add medicine to wishlist',
    description: 'Saves a medicine to the authenticated customer wishlist.',
  })
  @ApiResponse({ status: 201, description: 'Added to wishlist successfully' })
  async addToWishlist(
    @CurrentUser() user: any,
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    const customerId = user.userId || user.id;
    const result = await this.wishlistService.addToWishlist(customerId, productId);
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
    @CurrentUser() user: any,
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    const customerId = user.userId || user.id;
    const result = await this.wishlistService.removeFromWishlist(customerId, productId);
    return {
      success: true,
      message: result.message,
      data: result,
    };
  }
}
