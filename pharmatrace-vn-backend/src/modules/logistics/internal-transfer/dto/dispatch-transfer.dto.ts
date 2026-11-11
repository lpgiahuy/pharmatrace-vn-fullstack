import { IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class DispatchManifestLineDto {
  @IsInt() @Min(1) variantId: number;
  @IsInt() @Min(1) quantity: number;
  @IsArray() @IsString({ each: true }) boxUids: string[];
}

export class DispatchTransferDto {
  @ApiProperty({ enum: ['INTERNAL', 'THIRD_PARTY'] })
  @IsIn(['INTERNAL', 'THIRD_PARTY']) transportMode: 'INTERNAL' | 'THIRD_PARTY';
  @ApiPropertyOptional({ description: 'Active employee at the source facility, required for INTERNAL' })
  @IsOptional() @IsInt() @Min(1) transportEmployeeId?: number;
  @ApiPropertyOptional({ description: 'Required for THIRD_PARTY' })
  @IsOptional() @IsString() @MaxLength(100) courierName?: string;
  @ApiPropertyOptional({ description: 'Actual carrier tracking number, required for THIRD_PARTY' })
  @IsOptional() @IsString() @MaxLength(100) trackingCode?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => DispatchManifestLineDto)
  manifest: DispatchManifestLineDto[];
}
