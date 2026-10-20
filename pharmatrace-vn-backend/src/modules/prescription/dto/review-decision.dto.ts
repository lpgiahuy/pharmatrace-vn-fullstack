import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewDecisionDto {
  @ApiPropertyOptional({
    description: 'Review decision note or reason provided by the pharmacist',
    example: 'Prescription verified with doctor signature and dosage',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
