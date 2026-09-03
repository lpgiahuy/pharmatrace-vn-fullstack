import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsOptional,
  IsInt,
  IsPositive,
  IsString,
  IsBoolean,
  IsNumber,
  IsIn,
} from 'class-validator';

export class ProductQueryDto {
  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  page: number = 1;

  @ApiPropertyOptional({ description: 'Page size limit', default: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  limit: number = 12;

  @ApiPropertyOptional({ description: 'Keyword search for medicine name, active ingredients, registration number, or manufacturer' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by category ID or comma-separated category IDs' })
  @IsOptional()
  categoryId?: number | string;

  @ApiPropertyOptional({ description: 'Filter by packaging specification ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  packagingId?: number;

  @ApiPropertyOptional({ description: 'Filter by minimum price (VND)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minPrice?: number;

  @ApiPropertyOptional({ description: 'Filter by maximum price (VND)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPrice?: number;

  @ApiPropertyOptional({ description: 'Filter by manufacturer name' })
  @IsOptional()
  @IsString()
  manufacturer?: string;

  @ApiPropertyOptional({ description: 'Filter by country of origin' })
  @IsOptional()
  @IsString()
  countryOfOrigin?: string;

  @ApiPropertyOptional({ description: 'Filter by prescription requirement (true: Prescription, false: OTC)' })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true || value === 1 || value === '1') return true;
    if (value === 'false' || value === false || value === 0 || value === '0') return false;
    return undefined;
  })
  @IsBoolean()
  isPrescription?: boolean;

  @ApiPropertyOptional({ description: 'Filter by status (ACTIVE, INACTIVE, etc.)' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    enum: ['id', 'price', 'name', 'createdAt'],
    default: 'id',
  })
  @IsOptional()
  @IsIn(['id', 'price', 'name', 'createdAt'])
  sortBy: 'id' | 'price' | 'name' | 'createdAt' = 'id';

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: ['asc', 'desc'],
    default: 'asc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'asc';
}
