import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsEmail, IsNumber, Min, Max } from 'class-validator';

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

  @ApiProperty({ description: 'Latitude of the facility (-90 to 90)', example: 10.9728 })
  @IsNotEmpty({ message: 'Latitude is required for facility routing and transfer planning' })
  @IsNumber({}, { message: 'Latitude must be a valid number' })
  @Min(-90, { message: 'Latitude must be between -90 and 90' })
  @Max(90, { message: 'Latitude must be between -90 and 90' })
  latitude: number;

  @ApiProperty({ description: 'Longitude of the facility (-180 to 180)', example: 106.6849 })
  @IsNotEmpty({ message: 'Longitude is required for facility routing and transfer planning' })
  @IsNumber({}, { message: 'Longitude must be a valid number' })
  @Min(-180, { message: 'Longitude must be between -180 and 180' })
  @Max(180, { message: 'Longitude must be between -180 and 180' })
  longitude: number;
}
