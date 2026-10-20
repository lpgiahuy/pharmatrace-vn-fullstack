import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SwitchCartVariantDto {
  @ApiProperty({ description: 'Current packaging variant ID in cart', example: 12 })
  @Type(() => Number)
  @IsInt({ message: 'oldVariantId must be an integer' })
  @Min(1, { message: 'oldVariantId must be greater than 0' })
  oldVariantId: number;

  @ApiProperty({ description: 'New packaging variant ID to switch to', example: 13 })
  @Type(() => Number)
  @IsInt({ message: 'newVariantId must be an integer' })
  @Min(1, { message: 'newVariantId must be greater than 0' })
  newVariantId: number;
}
