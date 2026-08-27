import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { resolveLocale } from '../i18n/locale';
import { translateMessage } from '../i18n/messages';

@Catch(HttpException)
export class I18nExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const locale = resolveLocale(request.headers['accept-language']);
    const status = exception.getStatus();
    const body = exception.getResponse();

    response.status(status).json(localize(body, locale));
  }
}

function localize(
  body: string | object,
  locale: ReturnType<typeof resolveLocale>,
): unknown {
  if (typeof body === 'string') return translateMessage(body, locale);

  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string') {
    return { ...body, message: translateMessage(message, locale) };
  }
  if (Array.isArray(message)) {
    const translated = (message as unknown[]).map((m) =>
      typeof m === 'string' ? translateMessage(m, locale) : m,
    );
    return { ...body, message: translated };
  }
  return body;
}
