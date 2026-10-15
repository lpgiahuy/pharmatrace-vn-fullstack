import { IsOptional, IsInt, Min, Max, IsString, IsIn, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class OrderQueryDto {
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
  @Max(50)
  limit?: number = 10;

  @ApiPropertyOptional({
    example: 'PENDING',
    enum: ['PENDING', 'PROCESSING', 'SHIPPING', 'COMPLETED', 'CANCELLED', 'PARTIALLY_RETURNED'],
    description: 'Filter by order status',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'newest', enum: ['newest', 'oldest'], default: 'newest' })
  @IsOptional()
  @IsIn(['newest', 'oldest'])
  sort?: string = 'newest';

  @ApiPropertyOptional({ example: 'ORD-12345', description: 'Search by order code, recipient name or phone (Admin)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
