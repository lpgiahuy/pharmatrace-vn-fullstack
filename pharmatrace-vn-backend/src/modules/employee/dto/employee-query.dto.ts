import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class EmployeeQueryDto {
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

  @ApiPropertyOptional({ example: 'John', description: 'Search term for name, email, or job title' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 'STORE_MANAGER', description: 'Filter by role' })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({ example: 1, description: 'Filter by facility ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  facilityId?: number;

  @ApiPropertyOptional({ example: 'ACTIVE', description: 'Filter by status (ACTIVE or INACTIVE)' })
  @IsOptional()
  @IsString()
  status?: string;
}
