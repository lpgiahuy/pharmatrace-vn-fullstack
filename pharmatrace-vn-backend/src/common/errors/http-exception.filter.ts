import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { randomUUID } from 'crypto';
import type { Response } from 'express';

type FieldError = { field: string; message: string };
type ErrorBody = { code?: string; message?: string | string[]; details?: unknown; errors?: FieldError[] };

const DEFAULT_CODES: Record<number, string> = {
  400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE', 422: 'UNPROCESSABLE_ENTITY', 429: 'TOO_MANY_REQUESTS',
};
const SERVER_ERROR_MESSAGE = 'Something went wrong on our side. Please try again in a few minutes.';

export function validationException(errors: ValidationError[]) {
  const fields: FieldError[] = [];
  const walk = (list: ValidationError[], parent: string) => list.forEach(error => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    Object.values(error.constraints ?? {}).forEach(message => fields.push({ field, message }));
    walk(error.children ?? [], field);
  });
  walk(errors, '');
  const unique = fields.filter((entry, index) => fields.findIndex(other => other.field === entry.field && other.message === entry.message) === index);
  return new BadRequestException({ code: 'VALIDATION_FAILED', message: [...new Set(unique.map(entry => entry.message))].join(' '), errors: unique });
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const traceId = randomUUID();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;

    if (status >= 500) {
      this.logger.error(`[${traceId}] ${exception instanceof Error ? exception.stack : String(exception)}`);
      return response.status(status).json({ success: false, statusCode: status, code: 'INTERNAL_ERROR', message: SERVER_ERROR_MESSAGE, traceId });
    }

    const raw = (exception as HttpException).getResponse();
    const body: ErrorBody = typeof raw === 'string' ? { message: raw } : raw;
    response.status(status).json({
      success: false,
      statusCode: status,
      code: body.code ?? DEFAULT_CODES[status] ?? 'ERROR',
      message: Array.isArray(body.message) ? body.message.join('. ') : body.message ?? (exception as HttpException).message,
      ...(body.details ? { details: body.details } : {}),
      ...(body.errors ? { errors: body.errors } : {}),
      traceId,
    });
  }
}
