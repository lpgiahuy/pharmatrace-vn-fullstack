import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CustomerOrderQueryDto {
  @ApiPropertyOptional({ example: 1, description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 10, description: 'Items per page', default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @ApiPropertyOptional({
    example: 'DELIVERED',
    description: 'Filter by order status (PENDING, CONFIRMED, SHIPPING, DELIVERED, CANCELLED)',
  })
  @IsOptional()
  @IsString()
  orderStatus?: string;

  @ApiPropertyOptional({
    example: 'PAID',
    description: 'Filter by payment status (PAID, UNPAID, REFUNDED)',
  })
  @IsOptional()
  @IsString()
  paymentStatus?: string;
}
