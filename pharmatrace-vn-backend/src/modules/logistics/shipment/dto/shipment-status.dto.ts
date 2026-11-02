import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ShipmentStatusDto {
  @IsIn(['PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'DELIVERY_FAILED', 'RETURN_IN_TRANSIT', 'RETURNED_TO_WAREHOUSE']) status: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class ReturnShipmentDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason: string;
}

