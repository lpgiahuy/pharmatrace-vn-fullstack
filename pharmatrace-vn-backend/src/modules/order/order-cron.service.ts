import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class OrderCronService {
  private readonly logger = new Logger(OrderCronService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expireUnpaidOrders() {
    const rows = await this.prisma.withOrder('loyalty', tx => tx.$queryRaw<{ expired: number }[]>`
      SELECT public.expire_unpaid_orders() AS expired
    `);
    if (rows[0]?.expired) this.logger.log(`Expired ${rows[0].expired} unpaid order(s).`);
  }

  /**
   * Daily Cron Job: Automatically awards loyalty reward points to customers
   * after the return/refund window (default 7 days) has elapsed since order completion.
   * Runs daily at 1:00 AM.
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM, { timeZone: 'Asia/Ho_Chi_Minh' })
  async handleDailyPointAwardCron() {
    this.logger.log('Starting daily loyalty points award cron job...');
    const result = await this.awardPointsForCompletedOrders();
    this.logger.log(
      `Daily loyalty points cron completed: ${result.awardedCount} order(s) processed, total ${result.totalPointsAwarded} points awarded.`,
    );
  }

  /**
   * Core logic: Scans completed orders and awards points if the return window has passed.
   * Can also be triggered manually by Admin for testing.
   *
   */
  async awardPointsForCompletedOrders() {
    const days = Number(process.env.ORDER_RETURN_WINDOW_DAYS || 7);
    if (!Number.isInteger(days) || days < 0 || days > 3650) throw new BadRequestException('Invalid return window');

    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const eligibility: { where: Prisma.ordersWhereInput } = {
      where: {
        order_status: 'COMPLETED',
        payment_status: 'PAID',
        customer_id: { not: null },
        shipments: {
          is: {
            shipping_status: 'DELIVERED',
            actual_delivery_at: { lte: cutoffDate },
            return_category: null,
          },
        },
        loyalty_point_logs: {
          none: { transaction_type: { in: ['EARN', 'EARNED'] } },
        },
      },
    };
    const eligibleOrders = await this.prisma.withOrder('loyalty', tx => tx.orders.findMany(eligibility));

    const awardedDetails: Array<{
      orderId: number;
      orderCode: string;
      customerId: number;
      points: number;
    }> = [];

    let totalPointsAwarded = 0;

    for (const order of eligibleOrders) {
      if (!order.customer_id) continue;

      try {
        const awarded = await this.prisma.withOrder('loyalty', async (tx) => {
          await tx.$queryRaw`SELECT id FROM public.orders WHERE id = ${order.id} FOR UPDATE`;
          const eligible = await tx.orders.findFirst({ where: { ...eligibility.where, id: order.id } });
          if (!eligible) return 0;
          const disputes = await tx.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS (
            SELECT FROM public.delivery_disputes WHERE order_id=${order.id} AND outcome IS DISTINCT FROM 'DELIVERED'
          ) AS blocked`;
          if (disputes[0]?.blocked) return 0;
          const merchandisePaid = Math.max(0, Number(eligible.total_amount) - Number(eligible.shipping_fee || 0));
          const earnedPoints = Math.floor(merchandisePaid / 100);
          if (earnedPoints <= 0) return 0;
          // Increment customer reward points
          await tx.customers.update({
            where: { id: order.customer_id! },
            data: { reward_points: { increment: earnedPoints } },
          });

          // Create EARNED point ledger record
          await tx.loyalty_point_logs.create({
            data: {
              customer_id: order.customer_id!,
              order_id: order.id,
              transaction_type: 'EARN',
              points: earnedPoints,
              description: `Awarded ${earnedPoints} points for order #${order.order_code} after ${days}-day return window`,
            },
          });
          return earnedPoints;
        });
        if (!awarded) continue;

        totalPointsAwarded += awarded;
        awardedDetails.push({
          orderId: order.id,
          orderCode: order.order_code,
          customerId: order.customer_id,
          points: awarded,
        });

        this.logger.log(
          `Awarded ${awarded} loyalty points to customer #${order.customer_id} for order #${order.order_code}`,
        );
      } catch (err: unknown) {
        this.logger.error(
          `Failed to award points for order #${order.id} (${order.order_code}): ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      }
    }

    return {
      returnWindowDays: days,
      cutoffDate,
      totalEligible: eligibleOrders.length,
      awardedCount: awardedDetails.length,
      totalPointsAwarded,
      orders: awardedDetails,
    };
  }
}
