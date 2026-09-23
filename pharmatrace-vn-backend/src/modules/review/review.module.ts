import { Module } from '@nestjs/common';
import { ReviewService } from './review.service';
import { ReviewController } from './review.controller';
import { AdminReviewController } from './admin-review.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { ContentModerationModule } from '../moderation/content-moderation.module';

@Module({
  imports: [PrismaModule, CloudinaryModule, ContentModerationModule],
  controllers: [ReviewController, AdminReviewController],
  providers: [ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
