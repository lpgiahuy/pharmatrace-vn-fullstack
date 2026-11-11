import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ShipmentCarrierDto {
  @ApiProperty({ example: 'GHN' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString() @IsNotEmpty() @MaxLength(100)
  courierName: string;

  @ApiProperty({ description: 'Actual tracking number supplied by the carrier', example: 'GHN-123456' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @IsNotEmpty() @MaxLength(50)
  trackingNumber: string;
}
