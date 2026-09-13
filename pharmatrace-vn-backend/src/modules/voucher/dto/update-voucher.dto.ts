import {
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
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateVoucherDto {
  @ApiPropertyOptional({ example: 'SUMMER2026', description: 'Updated voucher code' })
  @IsOptional()
  @IsString()
  voucherCode?: string;

  @ApiPropertyOptional({ example: 'PERCENT', enum: ['PERCENT', 'FIXED'] })
  @IsOptional()
  @IsIn(['PERCENT', 'FIXED'])
  discountType?: string;

  @ApiPropertyOptional({ example: 15, description: 'Discount value' })
  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  discountValue?: number;

  @ApiPropertyOptional({ example: 150000, description: 'Minimum order subtotal' })
  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minOrderValue?: number;

  @ApiPropertyOptional({ example: 60000, description: 'Maximum discount amount' })
  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxDiscountAmount?: number;

  @ApiPropertyOptional({ example: 200, description: 'Total available voucher uses' })
  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalQuantity?: number;

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

  @ApiPropertyOptional({ example: 'ACTIVE', enum: ['ACTIVE', 'INACTIVE', 'EXPIRED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'EXPIRED'])
  status?: string;
}

