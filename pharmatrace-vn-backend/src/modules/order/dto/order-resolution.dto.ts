import { IsIn, IsNumber, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class ResolveDeliveryDisputeDto {
  @IsIn(['DELIVERED', 'NOT_DELIVERED']) outcome: string;
  @IsString() @MinLength(1) @MaxLength(500) reason: string;
}

export class ApproveCancellationRefundDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount: number;
  @IsIn(['CASH', 'BANK_TRANSFER', 'E_WALLET']) paymentMethod: string;
  @IsString() @MinLength(1) @MaxLength(500) reason: string;
}

export class RecordCancellationRefundDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount: number;
  @IsString() @MinLength(1) @MaxLength(100) paymentReference: string;
}
