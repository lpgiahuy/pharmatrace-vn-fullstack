import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class DeliveryProofDto {
  @IsIn(['CUSTOMER_SIGNATURE', 'DELIVERY_PHOTO', 'OTP', 'DISPATCH_NOTE', 'STAFF_CONFIRMATION'])
  proofType: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  proofReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  deliveredToName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryNotes?: string;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

export class DeliveryDisputeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

