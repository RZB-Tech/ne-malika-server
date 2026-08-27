import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { resolveLocale, type ApiLocale } from '../i18n/locale';

export const Locale = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiLocale => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined> }>();
    return resolveLocale(request.headers['accept-language']);
  },
);
