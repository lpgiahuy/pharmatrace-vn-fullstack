import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Expose deliberate workflow rejections without returning SQL or constraint internals. */
export async function workflowDatabase<T>(operation: Promise<T>): Promise<T> {
  try { return await operation; }
  catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
    const meta = error.meta as { code?: string; message?: string; driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } } | undefined;
    const code = meta?.code || meta?.driverAdapterError?.cause?.originalCode;
    const message = meta?.message || meta?.driverAdapterError?.cause?.originalMessage;
    if (code === '22023' && message) throw new BadRequestException(message);
    if (code === '42501') throw new ForbiddenException('Your role or facility cannot perform this action in the current state.');
    if (code === 'P0002') throw new NotFoundException('The requested workflow record was not found.');
    if (code === '23505' || code === '23514') throw new BadRequestException('The reference is already recorded or the supplied values are invalid. Reload and review the request.');
    throw error;
  }
}
