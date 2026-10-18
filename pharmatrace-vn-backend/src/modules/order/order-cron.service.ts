import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OrderCronService {
  private readonly logger = new Logger(OrderCronService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Daily Cron Job: Automatically awards loyalty reward points to customers
   * after the return/refund window (default 7 days) has elapsed since order completion.
   * Runs daily at 1:00 AM.
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
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
   * @param returnDays Optional override of the return window days (defaults to ORDER_RETURN_WINDOW_DAYS env or 7).
   */
  async awardPointsForCompletedOrders(returnDays?: number) {
    const days =
      typeof returnDays === 'number'
        ? returnDays
        : Number(process.env.ORDER_RETURN_WINDOW_DAYS || 7);

    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Find orders that:
    // 1. Have status 'COMPLETED'
    // 2. Have a customer associated
    // 3. Were delivered on or before cutoffDate (via shipment actual_delivery_at, or order created_at fallback)
    // 4. Have NOT yet had an 'EARNED' loyalty point log for this order
    const eligibleOrders = await this.prisma.orders.findMany({
      where: {
        order_status: 'COMPLETED',
        customer_id: { not: null },
        OR: [
          {
            shipments: {
              actual_delivery_at: { lte: cutoffDate },
            },
          },
          {
            shipments: null,
            created_at: { lte: cutoffDate },
          },
        ],
        loyalty_point_logs: {
          none: { transaction_type: { in: ['EARN', 'EARNED'] } },
        },
      },
      include: {
        customers: {
          select: {
            id: true,
            full_name: true,
            email: true,
          },
        },
        shipments: {
          select: {
            actual_delivery_at: true,
          },
        },
      },
    });

    const awardedDetails: Array<{
      orderId: number;
      orderCode: string;
      customerId: number;
      points: number;
    }> = [];

    let totalPointsAwarded = 0;

    for (const order of eligibleOrders) {
      if (!order.customer_id) continue;

      // 1% cashback on total amount (e.g., 100,000 VND -> 1,000 points)
      const earnedPoints = Math.floor(Number(order.total_amount || 0) / 100);
      if (earnedPoints <= 0) continue;

      try {
        await this.prisma.$transaction(async (tx) => {
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
        });

        totalPointsAwarded += earnedPoints;
        awardedDetails.push({
          orderId: order.id,
          orderCode: order.order_code,
          customerId: order.customer_id,
          points: earnedPoints,
        });

        this.logger.log(
          `Awarded ${earnedPoints} loyalty points to customer #${order.customer_id} for order #${order.order_code}`,
        );
      } catch (err: any) {
        this.logger.error(
          `Failed to award points for order #${order.id} (${order.order_code}): ${err?.message}`,
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
