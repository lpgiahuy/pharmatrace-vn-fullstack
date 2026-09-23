import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateReviewStatusDto {
  @ApiProperty({
    example: 'APPROVED',
    description: 'Review status',
    enum: ['APPROVED', 'PENDING', 'HIDDEN', 'SPAM'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['APPROVED', 'PENDING', 'HIDDEN', 'SPAM'])
  status: string;

  @ApiPropertyOptional({
    example: 'Review approved after manual verification',
    description: 'Optional moderator justification for audit log',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
