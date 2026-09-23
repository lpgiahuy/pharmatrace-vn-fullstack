import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ReplyReviewDto {
  @ApiProperty({
    example: 'Cảm ơn quý khách đã tin tưởng sử dụng sản phẩm của PharmaTrace VN. Chúc quý khách nhiều sức khỏe!',
    description: 'Admin or Pharmacist reply message',
  })
  @IsString()
  @IsNotEmpty({ message: 'Reply content cannot be empty' })
  reply: string;

  @ApiPropertyOptional({
    example: 'Dược sĩ PharmaTrace',
    description: 'Name of replier (Pharmacist or Support Staff)',
  })
  @IsOptional()
  @IsString()
  repliedByName?: string;
}
