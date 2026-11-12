import { applyDecorators } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

export const PHARMACY_FAULT_REASONS = ['WRONG_ITEM', 'DAMAGED', 'EXPIRED_OR_NEAR_EXPIRY', 'QUALITY_ISSUE'];
// OTHER is customer-described, so it is treated like a customer choice (fee may apply, not allowed for restricted items).
export const CUSTOMER_CHOICE_REASONS = ['CHANGED_MIND', 'ORDERED_WRONG', 'NO_LONGER_NEEDED', 'OTHER'];
const RETURN_STATUSES = ['REQUESTED', 'NEEDS_INFO', 'APPROVED', 'REJECTED', 'CANCELLED', 'RECEIVED', 'INSPECTED', 'REFUND_APPROVED', 'REFUNDED', 'CLOSED'];

const m = (message: string) => ({ message });
const Id = (label: string) => applyDecorators(IsInt(m(`${label} is invalid.`)), Min(1, m(`${label} is invalid.`)));
const Count = (label: string) => applyDecorators(IsInt(m(`${label} must be a whole number.`)), Min(0, m(`${label} cannot be negative.`)));
const Text = (label: string, max: number) => applyDecorators(IsString(m(`${label} must be text.`)), MaxLength(max, m(`${label} must be at most ${max} characters.`)));
const Required = (label: string, max: number) => applyDecorators(IsNotEmpty(m(`${label} is required.`)), Text(label, max));
const Lines = (type: () => new () => object) => applyDecorators(
  IsArray(m('The product list is invalid.')), ArrayMinSize(1, m('Select at least one product.')),
  ArrayMaxSize(50, m('A request can include at most 50 products.')), ValidateNested({ each: true }), Type(type),
);
const BoxUids = () => applyDecorators(IsOptional(), IsArray(m('The box code list is invalid.')), IsUUID('all', { each: true, message: 'A box code is invalid.' }));

export class ReturnLineDto {
  @Id('Product') orderItemId: number;
  @IsInt(m('Return quantity must be a whole number.')) @Min(1, m('Return quantity must be greater than 0.')) quantity: number;
  @IsIn([...PHARMACY_FAULT_REASONS, ...CUSTOMER_CHOICE_REASONS], m('Select a return reason.')) reasonCode: string;
  @IsOptional() @Text('Reason', 300) reasonNote?: string;
  @IsOptional() @Id('Replacement product') exchangeVariantId?: number;
}

export class CreateReturnDto {
  @Id('Order') orderId: number;
  @IsIn(['REFUND', 'EXCHANGE'], m('Choose a refund or an exchange.')) resolution: string;
  @IsIn(['CARRIER_PICKUP', 'STORE_DROP_OFF'], m('Choose how the goods will be returned.')) returnMethod: string;
  @IsOptional() @Text('Pickup address', 500) pickupAddress?: string;
  @IsOptional() @Text('Description', 1000) description?: string;
  @Lines(() => ReturnLineDto) lines: ReturnLineDto[];
}

export class StaffCreateReturnDto extends CreateReturnDto {
  @IsIn(['COUNTER', 'PHONE'], m('Choose the intake channel (counter or phone).')) channel: 'COUNTER' | 'PHONE';
}

export class ChangeReturnMethodDto {
  @IsIn(['CARRIER_PICKUP', 'STORE_DROP_OFF'], m('Choose how the goods will be returned.')) returnMethod: string;
  @IsOptional() @Text('Pickup address', 500) pickupAddress?: string;
}

export class ReturnNoteDto {
  @Required('Note', 1000) note: string;
}

export class ApproveReturnLineDto {
  @Id('Product') orderItemId: number;
  @Count('Approved quantity') approvedQuantity: number;
}

export class ApproveReturnDto {
  @Lines(() => ApproveReturnLineDto) lines: ApproveReturnLineDto[];
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, m('Return fee is invalid.')) @Min(0, m('Return fee cannot be negative.')) customerFee?: number;
  @IsOptional() @Text('Note', 1000) note?: string;
}

// Carrier waybill codes (GHN, GHTK, Viettel Post, VNPost, J&T...) are ASCII letters and digits, sometimes with dashes.
export const TRACKING_NUMBER = /^[A-Za-z0-9][A-Za-z0-9-]{3,39}$/;

export class ReturnCarrierDto {
  @Required('Courier', 100) courierName: string;
  @Required('Tracking number', 40)
  @Matches(TRACKING_NUMBER, m('Tracking number must be 4-40 letters or digits (dashes allowed), as printed on the waybill.'))
  trackingNumber: string;
}

export class ReceiveReturnLineDto {
  @Id('Product') orderItemId: number;
  @Count('Received quantity') quantity: number;
  @BoxUids() boxUids?: string[];
}

export class ReceiveReturnDto {
  @Lines(() => ReceiveReturnLineDto) lines: ReceiveReturnLineDto[];
}

export class InspectReturnLineDto {
  @Id('Product') orderItemId: number;
  @Count('Passed quantity') passQuantity: number;
  @Count('Failed quantity') failQuantity: number;
  /** Units that are not the product sold (another product, counterfeit, empty box). Never credited. */
  @IsOptional() @Count('Wrong-product quantity') mismatchQuantity?: number;
  @BoxUids() restockBoxUids?: string[];
  @BoxUids() scrapBoxUids?: string[];
}

export class InspectReturnDto {
  @IsOptional() @Text('Inspection notes', 1000) notes?: string;
  @Lines(() => InspectReturnLineDto) lines: InspectReturnLineDto[];
}

export class ReturnRefundDto {
  @IsIn(['CASH', 'BANK_TRANSFER', 'DEBIT_CARD', 'E_WALLET'], m('Choose a refund method.')) paymentMethod: string;
  @Required('Refund reason', 500) reason: string;
}

export class ReturnRefundPaymentDto {
  @Required('Payment reference', 100) paymentReference: string;
}

export class ReturnQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsIn(RETURN_STATUSES, m('The status filter is invalid.')) status?: string;
  @IsOptional() @Text('Search text', 100) q?: string;
}
