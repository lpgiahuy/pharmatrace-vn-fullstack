import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class AddToCartDto {
  @ApiProperty({ description: 'Packaging variant ID', example: 12 })
  @Type(() => Number)
  @IsInt({ message: 'variantId must be an integer' })
  @Min(1, { message: 'variantId must be greater than 0' })
  variantId: number;

  @ApiPropertyOptional({ description: 'Quantity to add to cart', example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'quantity must be an integer' })
  @Min(1, { message: 'quantity must be at least 1' })
  @Max(999, { message: 'quantity cannot exceed 999' })
  quantity?: number = 1;
}
