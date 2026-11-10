import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsNumber, IsString, Max, MaxLength, Min } from 'class-validator';

export class FulfillmentPolicyDto {
  @IsInt() @Min(1) sellingFacilityId: number;
  @IsBoolean() enabled: boolean;
  @IsInt() @Min(0) @Max(1439) opensMinute: number;
  @IsInt() @Min(1) @Max(1440) closesMinute: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) weekdays: number[];
  @IsInt() @Min(1) @Max(1000000) dailyCapacity: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(3000) radiusKm: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(100, { each: true }) transportConditions: string[];
}

export class TransportRequirementDto {
  @IsString() @MaxLength(100) condition: string;
}

export class WarehouseSellingPharmaciesDto {
  @IsArray() @ArrayMaxSize(200) @IsInt({ each: true }) @Min(1, { each: true }) pharmacyIds: number[];
}
