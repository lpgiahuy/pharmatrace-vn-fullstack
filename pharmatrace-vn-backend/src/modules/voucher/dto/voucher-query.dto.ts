import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class VoucherQueryDto {
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

  @ApiPropertyOptional({ example: 'PHARMA', description: 'Search keyword by voucher code' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 'ACTIVE', enum: ['ACTIVE', 'INACTIVE', 'EXPIRED'], description: 'Filter by status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'PERCENT', enum: ['PERCENT', 'FIXED'], description: 'Filter by discount type' })
  @IsOptional()
  @IsString()
  discountType?: string;

  @ApiPropertyOptional({ example: 'newest', enum: ['newest', 'oldest', 'usage_desc', 'usage_asc', 'min_order_asc', 'min_order_desc'], description: 'Sort criteria' })
  @IsOptional()
  @IsString()
  sort?: string;
}

