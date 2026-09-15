import { IsOptional, IsString, IsInt, Min, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class WishlistQueryDto {
  @ApiPropertyOptional({ example: 1, description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 12, description: 'Items per page', default: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 12;

  @ApiPropertyOptional({
    example: 'newest',
    enum: ['newest', 'oldest', 'price_asc', 'price_desc'],
    description: 'Sort criteria',
    default: 'newest',
  })
  @IsOptional()
  @IsIn(['newest', 'oldest', 'price_asc', 'price_desc'])
  sort?: string = 'newest';

  @ApiPropertyOptional({ example: 'Panadol', description: 'Search keyword within wishlisted medicines' })
  @IsOptional()
  @IsString()
  search?: string;
}
