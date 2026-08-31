import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CustomerQueryDto {
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

  @ApiPropertyOptional({ example: 'Customer', description: 'Search keyword (full name, email, or phone number)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 'GOLD', description: 'Filter by membership tier (BRONZE, SILVER, GOLD, PLATINUM, DIAMOND)' })
  @IsOptional()
  @IsString()
  membershipTier?: string;

  @ApiPropertyOptional({ example: 'ACTIVE', description: 'Filter by account status (ACTIVE, INACTIVE, BANNED)' })
  @IsOptional()
  @IsString()
  status?: string;
}
