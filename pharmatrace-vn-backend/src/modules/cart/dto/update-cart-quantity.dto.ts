import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateCartQuantityDto {
  @ApiProperty({
    description: 'New quantity for the cart item. Set to 0 to remove from cart.',
    example: 2,
  })
  @Type(() => Number)
  @IsInt({ message: 'quantity must be an integer' })
  @Min(0, { message: 'quantity cannot be negative' })
  @Max(999, { message: 'quantity cannot exceed 999' })
  quantity: number;
}
