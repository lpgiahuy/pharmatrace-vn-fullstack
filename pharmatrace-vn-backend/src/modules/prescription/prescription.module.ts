import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { PrescriptionController } from './prescription.controller';
import { PrescriptionService } from './prescription.service';

@Module({
  imports: [PrismaModule, CloudinaryModule],
  controllers: [PrescriptionController],
  providers: [PrescriptionService],
  exports: [PrescriptionService],
})
export class PrescriptionModule {}
