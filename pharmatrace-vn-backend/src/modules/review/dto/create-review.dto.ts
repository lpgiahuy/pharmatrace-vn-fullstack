import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  IsArray,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateReviewDto {
  @ApiProperty({ example: 5, description: 'Rating from 1 to 5 stars', minimum: 1, maximum: 5 })
  @IsInt({ message: 'Rating must be an integer' })
  @Min(1, { message: 'Rating must be at least 1 star' })
  @Max(5, { message: 'Rating cannot exceed 5 stars' })
  @Type(() => Number)
  ratingStars: number;

  @ApiProperty({
    example: 'Sản phẩm chính hãng, đóng gói cẩn thận, hạn sử dụng dài.',
    description: 'Review comment content',
  })
  @IsString()
  @IsNotEmpty({ message: 'Review comment cannot be empty' })
  @MaxLength(2000, { message: 'Review comment cannot exceed 2000 characters' })
  comment: string;

  @ApiPropertyOptional({
    example: ['https://res.cloudinary.com/...'],
    description: 'Optional review image URLs uploaded by customer',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5, { message: 'Maximum 5 images allowed per review' })
  @IsString({ each: true })
  images?: string[];
}
