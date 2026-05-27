import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.message
        : 'Internal server error';

    // Preserve custom fields carried on the HttpException body
    // (PaywallException's code/corpus, search-quota's quota object).
    // Default Nest exceptions only carry {statusCode,message,error} → the
    // canonical fields below overwrite them → byte-identical output.
    // Non-HttpException (500s) → no custom fields → body unchanged.
    let customFields: Record<string, unknown> = {};
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (res && typeof res === 'object') {
        customFields = res as Record<string, unknown>;
      }
    }

    // Never expose stack traces or internal details in production
    response.status(status).json({
      ...customFields,
      statusCode: status,
      message,
      error: HttpStatus[status] || 'Unknown Error',
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
