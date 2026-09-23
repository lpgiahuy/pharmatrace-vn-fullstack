import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class ReviewQueryDto {
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

  @ApiPropertyOptional({ example: 5, description: 'Filter reviews by exact star rating (1-5)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({
    example: 'newest',
    description: 'Sort reviews by newest, oldest, highest_rating, lowest_rating, most_helpful',
    enum: ['newest', 'oldest', 'highest_rating', 'lowest_rating', 'most_helpful'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['newest', 'oldest', 'highest_rating', 'lowest_rating', 'most_helpful'])
  sort?: 'newest' | 'oldest' | 'highest_rating' | 'lowest_rating' | 'most_helpful' = 'newest';
}
