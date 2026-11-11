import { Module } from '@nestjs/common';
import { InternalTransferModule } from './internal-transfer/internal-transfer.module';
import { ShipmentModule } from './shipment/shipment.module';

@Module({
  imports: [InternalTransferModule, ShipmentModule],
  exports: [InternalTransferModule, ShipmentModule],
})
export class LogisticsModule {}
