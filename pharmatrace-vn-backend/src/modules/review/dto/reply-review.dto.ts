import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ReplyReviewDto {
  @ApiProperty({
    example: 'Thank you for trusting PharmaTrace VN products. Wishing you good health!',
    description: 'Admin or Pharmacist reply message',
  })
  @IsString()
  @IsNotEmpty({ message: 'Reply content cannot be empty' })
  reply: string;

  @ApiPropertyOptional({
    example: 'PharmaTrace Pharmacist',
    description: 'Name of replier (Pharmacist or Support Staff)',
  })
  @IsOptional()
  @IsString()
  repliedByName?: string;
}
