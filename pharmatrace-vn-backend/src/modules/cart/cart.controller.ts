import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CartService } from './cart.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartQuantityDto } from './dto/update-cart-quantity.dto';
import { SwitchCartVariantDto } from './dto/switch-cart-variant.dto';
import { SyncCartDto } from './dto/sync-cart.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Customer - Cart')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('customer/cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({
    summary: 'Get customer shopping cart',
    description: 'Retrieves all items in the authenticated customer shopping cart with live prices and stock.',
  })
  @ApiResponse({ status: 200, description: 'Cart retrieved successfully' })
  async getCart(@CurrentUser() user: CurrentUserPayload) {
    const result = await this.cartService.getCart(user.id);
    return {
      success: true,
      message: 'Cart retrieved successfully',
      data: result,
    };
  }

  @Post()
  @ApiOperation({
    summary: 'Add item to cart',
    description: 'Adds a packaging variant to the cart or increments its quantity.',
  })
  @ApiResponse({ status: 201, description: 'Item added to cart successfully' })
  async addToCart(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: AddToCartDto,
  ) {
    const result = await this.cartService.addToCart(user.id, dto);
    return {
      success: true,
      message: 'Item added to cart successfully',
      data: result,
    };
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sync/merge guest cart upon login',
    description: 'Merges local guest cart items into the customer account cart across devices.',
  })
  @ApiResponse({ status: 200, description: 'Cart synchronized successfully' })
  async syncCart(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: SyncCartDto,
  ) {
    const result = await this.cartService.syncCart(user.id, dto);
    return {
      success: true,
      message: 'Cart synchronized successfully',
      data: result,
    };
  }

  @Patch('switch-variant')
  @ApiOperation({
    summary: 'Switch packaging variant for cart item',
    description: 'Switches an existing item in the cart to another unit of the same medicine.',
  })
  @ApiResponse({ status: 200, description: 'Cart variant switched successfully' })
  async switchVariant(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: SwitchCartVariantDto,
  ) {
    const result = await this.cartService.switchVariant(user.id, dto);
    return {
      success: true,
      message: 'Variant updated successfully',
      data: result,
    };
  }

  @Patch(':variantId')
  @ApiOperation({
    summary: 'Update cart item quantity',
    description: 'Updates the quantity of a variant item in cart. Set to 0 to remove.',
  })
  @ApiResponse({ status: 200, description: 'Quantity updated successfully' })
  async updateQuantity(
    @CurrentUser() user: CurrentUserPayload,
    @Param('variantId', ParseIntPipe) variantId: number,
    @Body() dto: UpdateCartQuantityDto,
  ) {
    const result = await this.cartService.updateQuantity(user.id, variantId, dto);
    return {
      success: true,
      message: 'Quantity updated successfully',
      data: result,
    };
  }

  @Delete(':variantId')
  @ApiOperation({
    summary: 'Remove item from cart',
    description: 'Removes a specific packaging variant from the customer cart.',
  })
  @ApiResponse({ status: 200, description: 'Item removed from cart successfully' })
  async removeItem(
    @CurrentUser() user: CurrentUserPayload,
    @Param('variantId', ParseIntPipe) variantId: number,
  ) {
    const result = await this.cartService.removeItem(user.id, variantId);
    return {
      success: true,
      message: 'Item removed from cart successfully',
      data: result,
    };
  }

  @Delete()
  @ApiOperation({
    summary: 'Clear entire shopping cart',
    description: 'Removes all items from the customer cart.',
  })
  @ApiResponse({ status: 200, description: 'Cart cleared successfully' })
  async clearCart(@CurrentUser() user: CurrentUserPayload) {
    const result = await this.cartService.clearCart(user.id);
    return {
      success: true,
      message: 'Cart cleared successfully',
      data: result,
    };
  }
}
