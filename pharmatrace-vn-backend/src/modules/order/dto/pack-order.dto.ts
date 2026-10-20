import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class PackOrderDto {
  @ApiPropertyOptional({
    description: 'Array of scanned medicine box UIDs to fulfill order items',
    type: [String],
    example: ['b1029cf3-0246-4e38-8159-7c2422b0a001', 'b1029cf3-0246-4e38-8159-7c2422b0a002'],
  })
  @IsOptional()
  @IsArray({ message: 'boxUids must be an array of strings' })
  @IsString({ each: true, message: 'Each box UID must be a valid string' })
  boxUids?: string[];

  @ApiPropertyOptional({
    description: 'Name of logistics courier',
    example: 'EXPRESS_LOGISTICS',
    default: 'EXPRESS_LOGISTICS',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  courierName?: string;

  @ApiPropertyOptional({
    description: 'Packaging or shipping note',
    example: 'Handle with care - fragile medicine bottles',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  shippingNote?: string;
}
