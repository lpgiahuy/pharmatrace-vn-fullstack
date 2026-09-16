import { IsArray, IsInt, ArrayNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CheckBatchWishlistDto {
  @ApiProperty({
    example: [1, 2, 3, 4],
    description: 'Array of medicine IDs to check in wishlist',
    type: [Number],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'productIds array cannot be empty' })
  @Type(() => Number)
  @IsInt({ each: true })
  productIds: number[];
}
