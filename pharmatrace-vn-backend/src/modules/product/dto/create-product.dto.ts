import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsInt,
  IsBoolean,
  IsArray,
  IsObject,
  Min,
  MaxLength,
} from 'class-validator';

export class CreateProductDto {
  @ApiProperty({
    description: 'Name of the medicine',
    example: 'Paracetamol 500mg Film-Coated Tablets',
  })
  @IsNotEmpty({ message: 'Medicine name is required' })
  @IsString({ message: 'Medicine name must be a string' })
  @MaxLength(255, { message: 'Medicine name must not exceed 255 characters' })
  medicineName: string;

  @ApiPropertyOptional({
    description: 'Primary category ID (Primary taxonomy)',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  primaryCategoryId?: number;

  @ApiPropertyOptional({
    description: 'Associated category IDs (All categories the product belongs to)',
    example: [1, 5, 8],
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  categoryIds?: number[];

  @ApiPropertyOptional({
    description: 'Legacy or shorthand category ID',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;


  @ApiPropertyOptional({
    description: 'Government medicine registration number',
    example: 'VN-12345-20',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  registrationNumber?: string;

  @ApiPropertyOptional({
    description: 'Active pharmaceutical ingredients',
    example: 'Paracetamol 500mg',
  })
  @IsOptional()
  @IsString()
  activeIngredients?: string;

  @ApiPropertyOptional({
    description: 'Recommended dosage specification',
    example: '500mg',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  dosage?: string;

  @ApiPropertyOptional({
    description: 'Pharmaceutical manufacturer',
    example: 'DHG Pharma',
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  manufacturer?: string;

  @ApiPropertyOptional({
    description: 'Country of origin',
    example: 'Vietnam',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  countryOfOrigin?: string;

  @ApiProperty({
    description: 'Unit retail price in VND',
    example: 45000,
  })
  @IsNotEmpty({ message: 'Unit price is required' })
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Unit price must be greater than or equal to 0' })
  unitPrice: number;

  @ApiPropertyOptional({
    description: 'Promotional discounted price in VND',
    example: 40000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Promotional price must be greater than or equal to 0' })
  promotionalPrice?: number;

  @ApiPropertyOptional({
    description: 'Product image URL',
    example: 'https://example.com/images/paracetamol.jpg',
  })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({
    description: 'Short summary description of the medicine',
    example: 'Effective relief for mild to moderate pain and fever.',
  })
  @IsOptional()
  @IsString()
  shortDescription?: string;

  @ApiPropertyOptional({
    description: 'Structured JSON details (ingredients, indications, contraindications, dosage instructions, etc.)',
    example: {
      ingredients: ['Paracetamol 500mg'],
      indications: 'Fever, headache, toothache',
      contraindications: 'Severe liver impairment',
    },
  })
  @IsOptional()
  @IsObject()
  details?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Whether prescription is required (true: Prescription Rx, false: OTC)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isPrescription?: boolean = false;

  @ApiPropertyOptional({
    description: 'Product status',
    default: 'ACTIVE',
    example: 'ACTIVE',
  })
  @IsOptional()
  @IsString()
  status?: string = 'ACTIVE';

  @ApiPropertyOptional({
    description: 'List of packaging variants (e.g. Box, Blister, Pill)',
    type: 'array',
  })
  @IsOptional()
  @IsArray()
  packagingVariants?: {
    unitName: string;
    price: number;
    originalPrice?: number;
    discountPercent?: number;
    isBaseUnit?: boolean;
    saleStartDate?: string | Date;
    saleEndDate?: string | Date;
  }[];
}
