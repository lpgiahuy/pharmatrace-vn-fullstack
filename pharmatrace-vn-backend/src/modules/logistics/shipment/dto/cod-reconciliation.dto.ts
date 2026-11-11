import { IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ReconcileCodDto {
  @IsNumber()
  @Min(0)
  grossAmount: number;

  @IsNumber()
  @Min(0)
  courierFee: number;

  @IsOptional()
  @IsNumber()
  adjustmentAmount?: number;

  @IsNumber()
  @Min(0)
  netAmount: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  statementReference: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  discrepancyNote?: string;
}

