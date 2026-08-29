import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { errorMessage } from '../../common/errors';
import { PaymeService, type PaymeResult } from './payme.service';
import {
  PAYME_ERROR,
  PaymeRpcError,
  parsePaymeRequest,
  requestId,
  verifyPaymeAuth,
  type PaymeErrorBody,
} from './payme-protocol';
import { PAYME_CONTROLLER_ROUTES } from './payme-routes';

interface PaymeAnswer {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: PaymeResult;
  error?: PaymeErrorBody;
}

const LOG_BODY_LIMIT = 1000;

function bodyForLog(body: unknown): string {
  try {
    return JSON.stringify(body).slice(0, LOG_BODY_LIMIT);
  } catch {
    return '<нечитаемое тело>';
  }
}

/**
 * Точка входа кассы Payme. Протокол считает ошибкой транспорта любой ответ,
 * кроме HTTP 200, поэтому все отказы уходят телом JSON-RPC.
 */
@ApiExcludeController()
@Controller(PAYME_CONTROLLER_ROUTES)
export class PaymeController {
  private readonly logger = new Logger(PaymeController.name);

  constructor(private readonly payme: PaymeService) {}

  @Public()
  @SkipThrottle()
  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ): Promise<PaymeAnswer> {
    const id = requestId(body);

    try {
      const key = this.payme.key();
      if (!key) {
        this.logger.error(
          'Запрос Payme отклонён: PAYME_KEY не задан — проверить авторизацию нечем',
        );
        throw PAYME_ERROR.insufficientPrivilege();
      }

      if (!verifyPaymeAuth(authorization, key)) {
        this.logger.warn(`Запрос Payme без прав: ${bodyForLog(body)}`);
        throw PAYME_ERROR.insufficientPrivilege();
      }

      const request = parsePaymeRequest(body);
      this.logger.log(
        `Запрос Payme ${request.method}: ${bodyForLog(request.params)}`,
      );

      const result = await this.payme.handle(request.method, request.params);
      return { jsonrpc: '2.0', id: request.id ?? id, result };
    } catch (error) {
      if (error instanceof PaymeRpcError) {
        this.logger.warn(
          `Payme отбит кодом ${error.code} (${error.message}): ${bodyForLog(body)}`,
        );
        return { jsonrpc: '2.0', id, error: error.body() };
      }

      const detail = errorMessage(error);
      this.logger.error(
        `Запрос Payme сорвался: ${detail} | ${bodyForLog(body)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        jsonrpc: '2.0',
        id,
        error: PAYME_ERROR.internal(detail).body(),
      };
    }
  }
}
