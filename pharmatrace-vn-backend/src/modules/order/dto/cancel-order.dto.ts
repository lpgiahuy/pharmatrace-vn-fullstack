import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelOrderDto {
  @IsIn(['CHANGED_MIND', 'ADDRESS_CHANGE', 'OTHER'])
  reasonCode: 'CHANGED_MIND' | 'ADDRESS_CHANGE' | 'OTHER';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonDetails?: string;
}
