import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsInt, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class SyncCartItemDto {
  @ApiProperty({ description: 'Packaging variant ID', example: 12 })
  @Type(() => Number)
  @IsInt({ message: 'variantId must be an integer' })
  @Min(1, { message: 'variantId must be greater than 0' })
  variantId: number;

  @ApiProperty({ description: 'Quantity from local cart', example: 2 })
  @Type(() => Number)
  @IsInt({ message: 'quantity must be an integer' })
  @Min(1, { message: 'quantity must be at least 1' })
  @Max(999, { message: 'quantity cannot exceed 999' })
  quantity: number;
}

export class SyncCartDto {
  @ApiProperty({
    description: 'Array of cart items to merge with server-side cart',
    type: [SyncCartItemDto],
  })
  @IsArray({ message: 'items must be an array' })
  @ValidateNested({ each: true })
  @Type(() => SyncCartItemDto)
  items: SyncCartItemDto[];
}
