import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DispatchTransferDto {
  @IsOptional() @IsString() @MaxLength(100) trackingCode?: string;
}
