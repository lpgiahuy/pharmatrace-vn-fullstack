import { IsBoolean, IsOptional } from 'class-validator';

export class HelpfulVoteDto {
  @IsOptional()
  @IsBoolean()
  isUnvote?: boolean;
}
