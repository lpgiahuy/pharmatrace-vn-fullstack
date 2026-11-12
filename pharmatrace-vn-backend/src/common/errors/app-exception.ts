import { HttpException, HttpStatus } from '@nestjs/common';

export class AppException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY,
    readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }
}
