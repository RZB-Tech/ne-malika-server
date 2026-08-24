import { Module } from '@nestjs/common';
import {
  openrouterClientProvider,
  OPENROUTER_CLIENT,
} from './openrouter-client.provider';

/**
 * Один клиент OpenRouter на всё приложение.
 *
 * Раньше провайдер перечислялся в каждом модуле, которому нужна модель, —
 * в пяти сразу. Nest создаёт провайдера на модуль, поэтому получалось пять
 * независимых клиентов: пять пулов соединений мимо общего keep-alive и пять
 * разных мест, где пришлось бы менять настройку.
 */
@Module({
  providers: [openrouterClientProvider],
  exports: [OPENROUTER_CLIENT],
})
export class OpenrouterModule {}
