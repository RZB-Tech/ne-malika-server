import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreditsRepository } from './credits.repository';
import { SettingsService } from '../settings/settings.service';
import type { CreditTxnMeta } from '../../db/schema';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { buildPaginatedResult } from '../../common/dto/paginated-response.dto';
import { CREDITS_PER_USD, usdToCredits } from './credits.constants';

/**
 * Занятый под запрос резерв. Возвращается из `reserve` и передаётся в
 * `settle`, чтобы вызывающий не пересчитывал сумму заново.
 */
export interface CreditHold {
  shopId: number;
  credits: number;
}

/**
 * Кредиты магазина на ИИ.
 *
 * Администратор работает без списания: у него нет магазина, а платит за его
 * запросы всё равно площадка. Для продавца порядок такой: занять резерв по
 * оценке → сделать запрос → списать фактическую стоимость из ответа
 * OpenRouter → освободить резерв.
 */
@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(
    private readonly repository: CreditsRepository,
    private readonly settings: SettingsService,
  ) {}

  /** Магазин продавца — нужен и для баланса, и для списания. */
  shopIdOf(ownerId: number): Promise<number | undefined> {
    return this.repository.findShopIdByOwner(ownerId);
  }

  balance(shopId: number) {
    return this.repository.find(shopId);
  }

  async history(shopId: number, query: PaginationQueryDto) {
    const { data, total, page, limit } = await this.repository.history(
      shopId,
      query,
    );
    return buildPaginatedResult(data, total, page, limit);
  }

  /**
   * Себестоимость запроса в кредиты, которые платит магазин. Наценка живёт
   * ровно здесь — и резерв, и списание проходят через неё, поэтому оценка и
   * факт всегда в одних единицах.
   */
  private async toCredits(usd: number): Promise<number> {
    const markup = await this.settings.getCreditMarkup();
    return usdToCredits(usd * markup);
  }

  /**
   * Занимает кредиты под запрос — на вход себестоимость в долларах, наценку
   * накидываем сами. `null` — списывать не с кого (администратор).
   *
   * Бросает, если у продавца нет активного магазина или не хватает остатка:
   * оба случая пользователь должен увидеть текстом, а не пустым результатом.
   */
  async hold(
    author: { id: number; isAdmin: boolean },
    estimateUsd: number,
    what: string,
  ): Promise<CreditHold | null> {
    if (author.isAdmin) return null;

    const credits = await this.toCredits(estimateUsd);
    const shopId = await this.repository.findShopIdByOwner(author.id);
    if (!shopId) {
      throw new ForbiddenException(
        'Генерация доступна только владельцу активного магазина.',
      );
    }

    if (await this.repository.reserve(shopId, credits)) {
      return { shopId, credits };
    }

    const current = await this.repository.find(shopId);
    const available = Math.max(
      0,
      (current?.balance ?? 0) - (current?.reserved ?? 0),
    );
    throw new ForbiddenException(
      available === 0
        ? 'Кредиты закончились. Обратитесь к администратору за пополнением.'
        : `Не хватает кредитов на ${what}: нужно ${credits}, доступно ${available}.`,
    );
  }

  /**
   * Списывает фактическую стоимость и снимает резерв.
   *
   * `usd` берётся из ответа OpenRouter. Если его нет (документация обещает
   * стоимость «когда доступна»), списываем резерв целиком и помечаем запись —
   * иначе запрос оказался бы бесплатным для магазина и платным для площадки.
   */
  async settle(
    hold: CreditHold | null,
    usd: number | undefined,
    meta: CreditTxnMeta,
  ): Promise<void> {
    if (!hold) return;

    const estimated = usd === undefined || usd <= 0;
    const credits = estimated ? hold.credits : await this.toCredits(usd);

    if (estimated) {
      this.logger.warn(
        `OpenRouter не вернул стоимость (${meta.operation ?? 'запрос'}, модель ${meta.model ?? '—'}) — списываем оценку ${hold.credits}`,
      );
    }

    try {
      await this.repository.spend(hold.shopId, hold.credits, credits, {
        ...meta,
        usd,
        estimated,
      });
    } catch (err) {
      this.logger.error(
        `Не удалось списать кредиты магазина ${hold.shopId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.repository.release(hold.shopId, hold.credits).catch(() => {});
    }
  }

  /** Запрос не состоялся — возвращаем резерв, ничего не списывая. */
  async cancel(hold: CreditHold | null): Promise<void> {
    if (!hold) return;
    await this.repository
      .release(hold.shopId, hold.credits)
      .catch((err: unknown) =>
        this.logger.error(
          `Не удалось снять резерв магазина ${hold.shopId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }

  /**
   * Выдача кредитов. Начисляем ровно оплаченное: $20 дают 20 000 кредитов,
   * чтобы баланс совпадал с деньгами, которые магазин отдал. Маржа площадки
   * берётся не здесь, а при списании — через тот же множитель.
   */
  async grant(
    shopId: number,
    authorId: number,
    paidUsd: number,
    note?: string,
  ): Promise<{ balance: number; credits: number; markup: number }> {
    const shop = await this.repository.find(shopId);
    if (!shop) throw new NotFoundException('Магазин не найден');

    const markup = await this.settings.getCreditMarkup();
    const credits = usdToCredits(paidUsd);

    const balance = await this.repository.grant({
      shopId,
      authorId,
      credits,
      note,
      meta: { paidUsd, markup },
    });

    this.logger.log(
      `Магазину ${shopId} начислено ${credits} кредитов (оплата $${paidUsd}, множитель ${markup})`,
    );
    return { balance, credits, markup };
  }

  /** Сколько кредитов даст сумма — для предпросмотра в форме выдачи. */
  async preview(paidUsd: number): Promise<{ credits: number; markup: number }> {
    const markup = await this.settings.getCreditMarkup();
    return { credits: usdToCredits(paidUsd), markup };
  }
}

export { CREDITS_PER_USD };
