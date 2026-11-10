import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class HaltTransferDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class RerouteTransferDto {
  @IsInt()
  @Min(1)
  newToFacilityId: number;

  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class ReceiveTransferReturnLineDto {
  @IsInt()
  @Min(1)
  variantId: number;

  @IsInt()
  @Min(0)
  goodQuantity: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  damagedQuantity?: number;

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

export class ReceiveTransferReturnDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveTransferReturnLineDto)
  lines?: ReceiveTransferReturnLineDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}

