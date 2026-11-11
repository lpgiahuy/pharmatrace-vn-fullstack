import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class OnlinePaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount: number;
  @IsIn(['BANK_TRANSFER', 'E_WALLET']) paymentMethod: string;
  @IsString() @MaxLength(100) paymentReference: string;
}

export class RejectOnlinePaymentDto {
  @IsString() @MaxLength(500) reason: string;
}

export class PaymentExceptionDto extends OnlinePaymentDto {
  @IsString() @MaxLength(500) reason: string;
}

export class ResolvePaymentExceptionDto {
  @IsIn(['APPROVE', 'APPLY', 'REFUND']) action: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount?: number;
  @IsString() @MaxLength(100) reference: string;
  @IsString() @MaxLength(500) reason: string;
}
