import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ShipmentStatusDto {
  @IsIn(['PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'DELIVERY_FAILED', 'RETURN_IN_TRANSIT', 'RETURNED_TO_WAREHOUSE']) status: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @ApiPropertyOptional({ description: 'Actual event time; defaults to the time of recording' })
  @IsOptional() @IsDateString() occurredAt?: string;
}

export class ReturnShipmentDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason: string;
}

