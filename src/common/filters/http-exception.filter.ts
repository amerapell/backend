import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { STATUS_CODES } from 'http';
import type { Response } from 'express';

/** Error body exactly as the API contract specifies (Nest default shape). */
export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

export function toApiError(exception: unknown): ApiErrorBody {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const res = exception.getResponse();
    const reason = STATUS_CODES[status] ?? 'Error';
    if (typeof res === 'string') return { statusCode: status, message: res, error: reason };
    const obj = res as Record<string, unknown>;
    const message = (obj.message as string | string[] | undefined) ?? exception.message;
    const error = typeof obj.error === 'string' ? obj.error : reason;
    return { statusCode: status, message, error };
  }
  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Internal server error',
    error: 'Internal Server Error',
  };
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const body = toApiError(exception);
    if (body.statusCode >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    }
    if (res.headersSent) return;
    res.status(body.statusCode).json(body);
  }
}
