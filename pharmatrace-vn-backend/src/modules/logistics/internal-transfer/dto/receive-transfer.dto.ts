import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ReceiveTransferLineDto {
  @IsInt()
  @Min(1)
  variantId: number;

  @IsInt()
  @Min(0)
  receivedQuantity: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  damagedQuantity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  missingQuantity?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  goodUids?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  damagedUids?: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ReceiveTransferDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveTransferLineDto)
  lines?: ReceiveTransferLineDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}

