import { IsNotEmpty, IsString, IsNumber, Min, MaxLength } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ValidateVoucherDto {
  @ApiProperty({ example: 'PHARMA10', description: 'Voucher code to validate' })
  @IsNotEmpty({ message: 'Voucher code is required' })
  @IsString()
  @MaxLength(50)
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  voucherCode: string;

  @ApiProperty({ example: 250000, description: 'Order subtotal amount before discount' })
  @IsNotEmpty({ message: 'Order subtotal is required' })
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Order subtotal must be greater than or equal to 0' })
  orderSubtotal: number;
}
