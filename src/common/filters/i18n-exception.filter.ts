import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { resolveLocale } from '../i18n/locale';
import { translateMessage } from '../i18n/messages';

/**
 * Переводит текст ошибки на язык запроса.
 *
 * Фильтр, а не перевод в момент throw: язык известен только из заголовка
 * запроса, а бросают ошибки сервисы и гварды, куда запрос не проброшен. Здесь
 * же ответ уже собран и правится в одном месте.
 *
 * Ловим только HttpException: у неперехваченной ошибки текст технический, его
 * пользователю всё равно не показывают, и обработку таких случаев оставляем
 * стандартному фильтру Nest.
 */
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

/**
 * Тело ответа Nest — либо строка, либо объект с полем message, где у ошибок
 * валидации лежит массив. Разбираем все три формы, остальное отдаём как есть.
 */
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
