import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export enum ReportReason {
  SPAM = 'SPAM',
  HARASSMENT = 'HARASSMENT',
  MISINFORMATION = 'MISINFORMATION',
  INAPPROPRIATE = 'INAPPROPRIATE',
  OTHER = 'OTHER',
}

export class CreateReportDto {
  @ApiProperty({
    enum: ReportReason,
    example: ReportReason.SPAM,
    description: 'Reason for reporting this review',
  })
  @IsEnum(ReportReason, {
    message: 'Reason must be one of: SPAM, HARASSMENT, MISINFORMATION, INAPPROPRIATE, OTHER',
  })
  @IsNotEmpty({ message: 'Report reason is required' })
  reason: ReportReason;

  @ApiPropertyOptional({
    example: 'This review contains fake advertising links and offensive language.',
    description: 'Optional detailed description or context for the report',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Description cannot exceed 500 characters' })
  description?: string;
}
