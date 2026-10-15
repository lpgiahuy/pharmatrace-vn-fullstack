import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsIn,
  Min,
  IsInt,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  MaxLength,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OrderItemDto {
  @ApiProperty({ example: 1, description: 'Packaging variant ID' })
  @IsNotEmpty({ message: 'variantId is required' })
  @IsInt()
  @Type(() => Number)
  variantId: number;

  @ApiProperty({ example: 2, description: 'Quantity of items to purchase' })
  @IsNotEmpty({ message: 'quantity is required' })
  @IsInt()
  @Min(1, { message: 'Quantity must be at least 1' })
  @Type(() => Number)
  quantity: number;
}

export class CreateOrderDto {
  @ApiProperty({
    type: [OrderItemDto],
    description: 'List of specific items to order',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Order must contain at least 1 item' })
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @ApiProperty({ example: '123 Nguyen Trai, Q1, TP.HCM', description: 'Shipping delivery address' })
  @IsNotEmpty({ message: 'Shipping address is required' })
  @IsString()
  @MaxLength(500)
  shippingAddress: string;

  @ApiPropertyOptional({ example: 10.7769, description: 'Optional customer delivery latitude' })
  @IsOptional()
  @Type(() => Number)
  latitude?: number;

  @ApiPropertyOptional({ example: 106.7009, description: 'Optional customer delivery longitude' })
  @IsOptional()
  @Type(() => Number)
  longitude?: number;

  @ApiProperty({ example: 'Nguyen Van A', description: 'Recipient full name' })
  @IsNotEmpty({ message: 'Recipient name is required' })
  @IsString()
  @MaxLength(100)
  recipientName: string;

  @ApiProperty({ example: '0901234567', description: 'Recipient phone number' })
  @IsNotEmpty({ message: 'Recipient phone is required' })
  @IsString()
  @MaxLength(20)
  recipientPhone: string;

  @ApiPropertyOptional({ example: 'COD', enum: ['COD', 'BANK_TRANSFER', 'E_WALLET'], default: 'COD' })
  @IsOptional()
  @IsIn(['COD', 'BANK_TRANSFER', 'E_WALLET'], { message: 'Invalid payment method' })
  paymentMethod?: string = 'COD';

  @ApiPropertyOptional({ example: 'SUMMER2026', description: 'Voucher promotional code' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  voucherCode?: string;

  @ApiPropertyOptional({ example: 0, description: 'Reward points to redeem for discount', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  usedPoints?: number = 0;

  @ApiPropertyOptional({ example: 1, description: 'ID of approved medical prescription if required' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  prescriptionId?: number;

  @ApiPropertyOptional({ example: 'Giao gio hanh chinh', description: 'Delivery note' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
