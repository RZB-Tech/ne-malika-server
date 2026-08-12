import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { resolveLocale, type ApiLocale } from '../i18n/locale';

/**
 * Язык запроса из Accept-Language — тот же источник, что и у переводчика ошибок,
 * поэтому текст ответа и текст ошибки не разъедутся.
 *
 * Параметром метода, а не `@Headers('accept-language')`: заголовок в подписи
 * попадает в OpenAPI обязательным полем, и сгенерированный клиент начинает
 * требовать его вручную — хотя он и так проставляется перехватчиком на каждый
 * запрос.
 */
export const Locale = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiLocale => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined> }>();
    return resolveLocale(request.headers['accept-language']);
  },
);
