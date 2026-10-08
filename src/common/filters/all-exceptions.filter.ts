import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Error as MongooseError } from 'mongoose';
import { isDuplicateKeyError } from '../utils/mongo-errors';

export interface ErrorResponseBody {
  success: false;
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

/**
 * Single place that shapes every error response. Keeps the
 * `statusCode / message / error` fields clients already rely on, and never
 * leaks internal/database error details for unexpected failures.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    const { statusCode, message } = this.resolve(exception);

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponseBody = {
      success: false,
      statusCode,
      error: HttpStatus[statusCode]?.replace(/_/g, ' ') ?? 'Error',
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    };
    response.status(statusCode).json(body);
  }

  private resolve(exception: unknown): {
    statusCode: number;
    message: string | string[];
  } {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const message =
        typeof res === 'string'
          ? res
          : (res as { message?: string | string[] }).message ??
            exception.message;
      return { statusCode: exception.getStatus(), message };
    }
    if (isDuplicateKeyError(exception)) {
      return {
        statusCode: HttpStatus.CONFLICT,
        message: 'Resource already exists',
      };
    }
    if (exception instanceof MongooseError.CastError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: `Invalid value for ${exception.path}`,
      };
    }
    if (exception instanceof MongooseError.ValidationError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: Object.values(exception.errors).map((e) => e.message),
      };
    }
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };
  }
}
