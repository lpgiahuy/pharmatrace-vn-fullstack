import { IsNotEmpty, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateOrderStatusDto {
  @ApiPropertyOptional({
    example: 'PROCESSING',
    enum: ['PENDING', 'PROCESSING', 'SHIPPING', 'COMPLETED', 'CANCELLED', 'RETURNED', 'PARTIALLY_RETURNED'],
    description: 'Target order status (optional if updating only payment status or note)',
  })
  @IsOptional()
  @IsIn(
    ['PENDING', 'PROCESSING', 'SHIPPING', 'COMPLETED', 'CANCELLED', 'RETURNED', 'PARTIALLY_RETURNED'],
    { message: 'Invalid order status transition' },
  )
  orderStatus?: string;

  @ApiPropertyOptional({
    example: 'PAID',
    enum: ['UNPAID', 'PAID', 'REFUNDED'],
    description: 'Update payment status if needed',
  })
  @IsOptional()
  @IsIn(['UNPAID', 'PAID', 'REFUNDED'])
  paymentStatus?: string;

  @ApiPropertyOptional({ example: 'Confirmed prescription and customer details', description: 'Admin note' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
