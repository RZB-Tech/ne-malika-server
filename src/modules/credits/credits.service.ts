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
import {
  CREDITS_PER_USD,
  WELCOME_CREDITS,
  WELCOME_NOTE,
  WELCOME_PROMO,
  usdToCredits,
} from './credits.constants';

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
    return this.reserve(author.id, await this.toCredits(estimateUsd), what);
  }

  /**
   * Занимает ровно назначенную цену — для операций с фиксированным прайсом.
   *
   * Наценка здесь не при чём: она пересчитывает себестоимость, а прайс уже
   * объявлен продавцу и от курса модели не зависит. Списывать такой резерв
   * нужно через `settleFixed`, иначе фактическая стоимость перебьёт цену.
   */
  async holdFixed(
    author: { id: number; isAdmin: boolean },
    credits: number,
    what: string,
  ): Promise<CreditHold | null> {
    if (author.isAdmin) return null;
    return this.reserve(author.id, credits, what);
  }

  /** Общая часть обоих резервов: найти магазин и занять у него сумму. */
  private async reserve(
    ownerId: number,
    credits: number,
    what: string,
  ): Promise<CreditHold> {
    const shopId = await this.repository.findShopIdByOwner(ownerId);
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
   * Списывает фактическую стоимость и снимает резерв. Возвращает списанное —
   * журнал использования ИИ пишет ту же цифру, что увидел магазин.
   *
   * `usd` берётся из ответа OpenRouter. Если его нет (документация обещает
   * стоимость «когда доступна»), списываем резерв целиком и помечаем запись —
   * иначе запрос оказался бы бесплатным для магазина и платным для площадки.
   */
  async settle(
    hold: CreditHold | null,
    usd: number | undefined,
    meta: CreditTxnMeta,
  ): Promise<number> {
    if (!hold) return 0;

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
      return credits;
    } catch (err) {
      this.logger.error(
        `Не удалось списать кредиты магазина ${hold.shopId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.repository.release(hold.shopId, hold.credits).catch(() => {});
      return 0;
    }
  }

  /**
   * Списывает назначенный прайс целиком, чем бы запрос ни обошёлся площадке.
   *
   * Фактическая стоимость идёт в журнал, но на сумму не влияет: цену кнопки
   * продавец увидел до нажатия, и пересчитывать её задним числом — обман
   * ожидания, даже когда пересчёт вышел бы в его пользу.
   *
   * Резерв и списание здесь всегда равны, поэтому отдельного возврата остатка
   * не бывает: либо списали прайс, либо (при сбое записи) сняли резерв целиком
   * и не взяли ничего.
   */
  async settleFixed(
    hold: CreditHold | null,
    usd: number | undefined,
    meta: CreditTxnMeta,
  ): Promise<number> {
    if (!hold) return 0;

    try {
      await this.repository.spend(hold.shopId, hold.credits, hold.credits, {
        ...meta,
        usd,
        fixed: true,
      });
      return hold.credits;
    } catch (err) {
      this.logger.error(
        `Не удалось списать кредиты магазина ${hold.shopId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.repository.release(hold.shopId, hold.credits).catch(() => {});
      return 0;
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

  /**
   * Приветственные кредиты новому магазину — акция «попробуй генерацию
   * бесплатно». Выдаются один раз: повторную выдачу ловим по метке в журнале,
   * иначе удалённый и заново созданный магазин получал бы подарок снова.
   *
   * Автор выдачи пустой: начисляет система. Возвращает начисленное — 0 значит
   * «уже получал», и вызывающему не о чем сообщать.
   */
  async grantWelcome(shopId: number): Promise<number> {
    if (await this.repository.hasPromo(shopId, WELCOME_PROMO)) {
      return 0;
    }

    await this.repository.grant({
      shopId,
      authorId: null,
      credits: WELCOME_CREDITS,
      note: WELCOME_NOTE,
      meta: { promo: WELCOME_PROMO },
    });

    this.logger.log(
      `Магазину ${shopId} начислено ${WELCOME_CREDITS} приветственных кредитов`,
    );
    return WELCOME_CREDITS;
  }

  /**
   * Отобрать кредиты — ошибочная выдача, возврат оплаты, санкция.
   *
   * Отдельным видом операции (`adjust`), а не выдачей с минусом: в истории
   * магазина должно быть видно, что баланс уменьшил человек, а не запрос к
   * модели.
   */
  async revoke(
    shopId: number,
    authorId: number,
    credits: number,
    note?: string,
  ): Promise<{ balance: number; taken: number }> {
    const shop = await this.repository.find(shopId);
    if (!shop) throw new NotFoundException('Магазин не найден');

    const result = await this.repository.revoke({
      shopId,
      authorId,
      credits,
      note,
    });

    this.logger.log(
      `У магазина ${shopId} снято ${result.taken} кредитов из запрошенных ${credits}, остаток ${result.balance}`,
    );
    return result;
  }

  /** Сколько кредитов даст сумма — для предпросмотра в форме выдачи. */
  async preview(paidUsd: number): Promise<{ credits: number; markup: number }> {
    const markup = await this.settings.getCreditMarkup();
    return { credits: usdToCredits(paidUsd), markup };
  }
}

export { CREDITS_PER_USD };
