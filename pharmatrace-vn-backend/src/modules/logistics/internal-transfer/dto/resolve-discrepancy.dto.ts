import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ResolveDiscrepancyDto {
  @IsIn(['RESUPPLY', 'ACCEPT_SHORTAGE']) action: 'RESUPPLY' | 'ACCEPT_SHORTAGE';
  @IsOptional() @IsInt() @Min(1) sourceFacilityId?: number;
  @IsString() @MaxLength(500) reason: string;
  @IsOptional() @IsString() @MaxLength(500) customerAgreement?: string;
}
