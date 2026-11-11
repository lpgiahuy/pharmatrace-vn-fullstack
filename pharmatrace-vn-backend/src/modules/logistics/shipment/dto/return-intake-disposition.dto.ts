import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class RequestPostDeliveryReturnDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RequestedReturnLineDto)
  lines: RequestedReturnLineDto[];
}

export class RequestedReturnLineDto {
  @IsInt() @Min(1) variantId: number;
  @IsInt() @Min(1) quantity: number;
}

export class ReceiveReturnDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceivedReturnLineDto)
  receivedLines: ReceivedReturnLineDto[];
}

export class ReceivedReturnLineDto {
  @IsInt()
  @Min(1)
  variantId: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  boxUids?: string[];
}

export class ReturnDispositionLineDto {
  @IsInt()
  @Min(1)
  variantId: number;

  @IsInt()
  @Min(0)
  passQuantity: number;

  @IsInt()
  @Min(0)
  failQuantity: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  restockBoxUids?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scrapBoxUids?: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ReturnDispositionDto {
  @IsIn(['RESTOCK', 'SCRAP', 'PARTIAL_RESTOCK'])
  decision: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  qaNotes: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnDispositionLineDto)
  lines: ReturnDispositionLineDto[];
}

