import { Module } from '@nestjs/common';
import { InternalTransferModule } from './internal-transfer/internal-transfer.module';

@Module({
  imports: [InternalTransferModule],
  exports: [InternalTransferModule],
})
export class LogisticsModule {}
