import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { LogisticsController } from './logistics.controller';
import { LogisticsService } from './logistics.service';

@Module({
  imports: [PrismaModule],
  controllers: [LogisticsController],
  providers: [LogisticsService],
  exports: [LogisticsService],
})
export class ShipmentModule {}
