import { IsIn, IsNumber, IsString, MaxLength, Min } from 'class-validator';

export class ReturnRefundDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) goodsValue: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) customerFee: number;
  @IsIn(['CASH', 'BANK_TRANSFER', 'DEBIT_CARD', 'E_WALLET']) paymentMethod: string;
  @IsString() @MaxLength(500) reason: string;
}

export class RecordRefundPaymentDto {
  @IsString() @MaxLength(100) paymentReference: string;
}
