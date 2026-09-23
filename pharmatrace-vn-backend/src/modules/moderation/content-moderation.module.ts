import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ContentModerationService } from './content-moderation.service';
import { AdminModerationController } from './admin-moderation.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AdminModerationController],
  providers: [ContentModerationService],
  exports: [ContentModerationService],
})
export class ContentModerationModule {}
