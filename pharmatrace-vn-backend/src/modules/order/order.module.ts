import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OrderService } from './order.service';
import { AdminOrderService } from './admin-order.service';
import { OrderCronService } from './order-cron.service';
import { OrderController } from './order.controller';
import { AdminOrderController } from './admin-order.controller';

@Module({
  imports: [PrismaModule],
  controllers: [OrderController, AdminOrderController],
  providers: [OrderService, AdminOrderService, OrderCronService],
  exports: [OrderService, AdminOrderService, OrderCronService],
})
export class OrderModule {}
