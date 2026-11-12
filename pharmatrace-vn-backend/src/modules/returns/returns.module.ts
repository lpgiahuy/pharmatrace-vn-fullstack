import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { AdminReturnsController } from './admin-returns.controller';
import { CustomerReturnsController } from './customer-returns.controller';
import { ReturnsService } from './returns.service';

@Module({
  imports: [PrismaModule, CloudinaryModule],
  controllers: [CustomerReturnsController, AdminReturnsController],
  providers: [ReturnsService],
})
export class ReturnsModule {}
