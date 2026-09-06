import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsEmail, IsNumber, IsEnum } from 'class-validator';

export enum FacilityTypeEnum {
  MANUFACTURER = 'MANUFACTURER',
  CENTRAL_WAREHOUSE = 'CENTRAL_WAREHOUSE',
  BRANCH_WAREHOUSE = 'BRANCH_WAREHOUSE',
  PHARMACY = 'PHARMACY',
}

export class CreateFacilityDto {
  @ApiProperty({ description: 'Name of the facility / warehouse / pharmacy', example: 'PharmaTrace Central Plant' })
  @IsString()
  @IsNotEmpty({ message: 'Facility name is required' })
  name: string;

  @ApiProperty({
    description: 'Facility type classification',
    enum: FacilityTypeEnum,
    example: FacilityTypeEnum.MANUFACTURER,
  })
  @IsString()
  @IsNotEmpty({ message: 'Facility type is required' })
  type: string;

  @ApiPropertyOptional({ description: 'Full physical address', example: 'VSIP Industrial Park, Thuan An, Binh Duong' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ description: 'Contact phone number', example: '02838901234' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional({ description: 'Official email address', example: 'plant@pharmatrace.vn' })
  @IsOptional()
  @IsEmail({}, { message: 'Invalid email format' })
  email?: string;

  @ApiPropertyOptional({ description: 'Latitude for map visualization', example: 10.9728 })
  @IsOptional()
  @IsNumber({}, { message: 'Latitude must be a valid number' })
  latitude?: number;

  @ApiPropertyOptional({ description: 'Longitude for map visualization', example: 106.6849 })
  @IsOptional()
  @IsNumber({}, { message: 'Longitude must be a valid number' })
  longitude?: number;
}
