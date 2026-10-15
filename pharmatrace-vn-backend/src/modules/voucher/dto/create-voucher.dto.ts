import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  Min,
  IsDateString,
  IsInt,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVoucherDto {
  @ApiProperty({ example: 'SUMMER2026', description: 'Unique voucher code' })
  @IsNotEmpty({ message: 'Voucher code is required' })
  @IsString()
  voucherCode: string;

  @ApiPropertyOptional({ example: 'PERCENT', enum: ['PERCENT', 'FIXED'], default: 'PERCENT' })
  @IsOptional()
  @IsIn(['PERCENT', 'FIXED'], { message: 'Discount type must be PERCENT or FIXED' })
  discountType?: string = 'PERCENT';

  @ApiProperty({ example: 10, description: 'Discount value (percentage 1-100 or cash amount)' })
  @IsNotEmpty({ message: 'Discount value is required' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01, { message: 'Discount value must be greater than 0' })
  discountValue: number;

  @ApiPropertyOptional({ example: 100000, description: 'Minimum order subtotal to apply voucher', default: 0 })
  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minOrderValue?: number = 0;

  @ApiPropertyOptional({ example: 50000, description: 'Maximum discount amount capped (for PERCENT type)' })
  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxDiscountAmount?: number;

  @ApiProperty({ example: 100, description: 'Total available voucher uses (usage limit)' })
  @IsNotEmpty({ message: 'Voucher usage limit (totalQuantity) is required' })
  @Type(() => Number)
  @IsInt({ message: 'Usage limit must be an integer' })
  @Min(1, { message: 'Usage limit must be at least 1' })
  totalQuantity: number;

  @ApiPropertyOptional({ example: '2026-06-01T00:00:00Z', description: 'Start validity timestamp' })
  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined && val !== '')
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59Z', description: 'End validity timestamp' })
  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined && val !== '')
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ example: 'ACTIVE', enum: ['ACTIVE', 'INACTIVE', 'EXPIRED'], default: 'ACTIVE' })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'EXPIRED'])
  status?: string = 'ACTIVE';
}

