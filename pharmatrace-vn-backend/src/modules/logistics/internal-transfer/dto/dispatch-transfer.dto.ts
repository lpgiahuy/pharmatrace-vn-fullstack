import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DispatchTransferDto {
  @ApiProperty({ enum: ['INTERNAL', 'THIRD_PARTY'] })
  @IsIn(['INTERNAL', 'THIRD_PARTY']) transportMode: 'INTERNAL' | 'THIRD_PARTY';
  @ApiPropertyOptional({ description: 'Active employee at the source facility, required for INTERNAL' })
  @IsOptional() @IsInt() @Min(1) transportEmployeeId?: number;
  @ApiPropertyOptional({ description: 'Required for THIRD_PARTY' })
  @IsOptional() @IsString() @MaxLength(100) courierName?: string;
  @ApiPropertyOptional({ description: 'Actual carrier tracking number, required for THIRD_PARTY' })
  @IsOptional() @IsString() @MaxLength(100) trackingCode?: string;
}
