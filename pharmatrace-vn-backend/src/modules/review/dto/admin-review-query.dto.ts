import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class AdminReviewQueryDto {
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
  @Max(100)
  limit?: number = 10;

  @ApiPropertyOptional({
    example: 'ALL',
    description: 'Filter reviews by status',
    enum: ['ALL', 'APPROVED', 'PENDING', 'HIDDEN', 'SPAM'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['ALL', 'APPROVED', 'PENDING', 'HIDDEN', 'SPAM'])
  status?: string = 'ALL';

  @ApiPropertyOptional({ example: 5, description: 'Filter reviews by rating (1-5)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ example: 'Paracetamol', description: 'Search by customer name, medicine name, or comment' })
  @IsOptional()
  @IsString()
  search?: string;
}
