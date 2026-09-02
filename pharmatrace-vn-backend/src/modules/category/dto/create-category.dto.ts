import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({
    description: 'Name of the medicine category',
    example: 'Antibiotics',
  })
  @IsNotEmpty({ message: 'Category name is required' })
  @IsString({ message: 'Category name must be a string' })
  @MaxLength(100, { message: 'Category name must not exceed 100 characters' })
  categoryName: string;

  @ApiPropertyOptional({
    description: 'Detailed description of the category',
    example: 'Medicines used to treat bacterial infections',
  })
  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  description?: string;

  @ApiPropertyOptional({
    description: 'Icon identifier or image URL for the category',
    example: 'pill',
  })
  @IsOptional()
  @IsString({ message: 'Icon must be a string' })
  @MaxLength(100, { message: 'Icon must not exceed 100 characters' })
  icon?: string;

  @ApiPropertyOptional({
    description: 'Parent category ID for hierarchical nesting',
    example: 1,
  })
  @IsOptional()
  parentId?: number | null;

  @ApiPropertyOptional({
    description: 'Display order priority',
    example: 0,
  })
  @IsOptional()
  displayOrder?: number;

  @ApiPropertyOptional({
    description: 'Active status',
    example: 'ACTIVE',
  })
  @IsOptional()
  status?: string;
}

