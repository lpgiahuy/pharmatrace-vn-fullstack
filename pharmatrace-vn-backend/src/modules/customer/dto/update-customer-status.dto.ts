import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCustomerStatusDto {
  @ApiProperty({
    example: 'INACTIVE',
    description: 'New account status (ACTIVE, INACTIVE, BANNED)',
  })
  @IsNotEmpty()
  @IsString()
  status: string;
}
