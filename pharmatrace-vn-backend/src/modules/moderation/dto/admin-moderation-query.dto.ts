import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class AdminModerationQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ example: 10, default: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number = 10;

  @ApiPropertyOptional({
    example: 'PENDING',
    description: 'Filter by status: PENDING, RESOLVED, DISMISSED, or ALL',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    example: 'SPAM',
    description: 'Filter by reason: SPAM, HARASSMENT, MISINFORMATION, INAPPROPRIATE, OTHER',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ResolveReportDto {
  @ApiPropertyOptional({
    example: 'Review removed due to spam policy violation',
    description: 'Note from moderator regarding resolution or dismissal',
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    enum: ['HIDE', 'SPAM', 'APPROVE', 'KEEP'],
    description: 'Action to apply on the target review',
  })
  @IsOptional()
  @IsIn(['HIDE', 'SPAM', 'APPROVE', 'KEEP'])
  actionOnReview?: 'HIDE' | 'SPAM' | 'APPROVE' | 'KEEP';
}

export class AdminAuditQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number = 20;

  @ApiPropertyOptional({ example: 123, description: 'Filter by specific review ID' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  reviewId?: number;

  @ApiPropertyOptional({ example: 'APPROVE', description: 'Filter by action name' })
  @IsOptional()
  @IsString()
  action?: string;
}
