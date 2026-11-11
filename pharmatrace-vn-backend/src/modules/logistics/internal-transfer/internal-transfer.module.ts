import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { InternalTransferService } from './internal-transfer.service';
import { InternalTransferController } from './internal-transfer.controller';

@Module({
  imports: [PrismaModule],
  controllers: [InternalTransferController],
  providers: [InternalTransferService],
  exports: [InternalTransferService],
})
export class InternalTransferModule {}
