import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Корневой роут служит liveness-пробой: на него смотрят HEALTHCHECK в
  // Dockerfile и проверка после деплоя. Без @Public() глобальный
  // JwtAuthGuard отвечает 401 и контейнер числится unhealthy.
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
