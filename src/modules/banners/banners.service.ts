import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ShopsService } from '../shops/shops.service';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { effectiveLimits } from '../subscriptions/subscriptions.constants';
import { escapeHtml, excerpt } from '../bot/telegram-html';
import { buildPaginatedResult } from '../../common/dto/paginated-response.dto';
import { BannersRepository } from './banners.repository';
import {
  bucketKey,
  MAX_ACTIVE_BANNERS,
  SHOP_BANNER_SLOTS,
} from './banners.constants';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { CreateShopBannerDto } from './dto/create-shop-banner.dto';
import { UpdateShopBannerDto } from './dto/update-shop-banner.dto';
import { ModerateBannerDto } from './dto/moderate-banner.dto';
import { FindShopBannersQueryDto } from './dto/find-shop-banners-query.dto';

/**
 * Отказ на гейте тарифа. Одна константа на создание и правку: текст, набранный
 * дважды, расходится на первой же правке формулировки, а ключом перевода в
 * `common/i18n/messages.ts` служит сама русская строка — разъехавшись, вторая
 * копия молча останется непереведённой.
 */
const PLAN_REQUIRED = 'Баннер доступен на тарифе MAX';

/** Раздел кабинета, в который ведут все уведомления о баннере. */
const SELLER_BANNER_PATH = '/seller/banner';

@Injectable()
export class BannersService {
  private readonly logger = new Logger(BannersService.name);

  constructor(
    private readonly repository: BannersRepository,
    private readonly shopsService: ShopsService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Витрина главной: площадочные баннеры вперемешку с оплаченными.
   *
   * Две выборки и склейка здесь, а не один запрос с `UNION`: у половин разный
   * порядок и разные условия отбора, а делёжка мест — правило продукта, и жить
   * оно должно там, где его видно, а не внутри SQL.
   *
   * Порядок склейки: первый слот площадке, следом баннеры продавцов, дальше
   * остаток площадочных. Разбор — в докблоке `SHOP_BANNER_SLOTS`; комментарий
   * и код обязаны совпадать, потому что это единственное место, где обещание
   * «платный баннер гарантированно виден» либо выполняется, либо нет.
   *
   * Обрезка по `MAX_ACTIVE_BANNERS` стоит в конце и режет именно хвост
   * площадочных: продавцы уже ограничены `SHOP_BANNER_SLOTS`, и вытеснить
   * оплаченный баннер длинной каруселью площадки нельзя.
   *
   * Пустой список площадочных — не особый случай: продавцы просто встают с
   * первого места. Резервировать место, которое некому занять, значило бы
   * показывать покупателю дырку.
   */
  async findActive() {
    const [platform, shop] = await Promise.all([
      this.repository.findActivePlatform(MAX_ACTIVE_BANNERS),
      this.repository.findActiveShop(bucketKey(), SHOP_BANNER_SLOTS),
    ]);

    const [lead, ...rest] = platform;
    const head = lead ? [lead] : [];

    return [...head, ...shop, ...rest].slice(0, MAX_ACTIVE_BANNERS);
  }

  findAllForAdmin() {
    return this.repository.findAll();
  }

  /**
   * Новый баннер встаёт в конец карусели, если порядок не задан явно: иначе
   * все созданные подряд получали бы sortOrder 0 и раскладывались по id — то
   * есть в порядке создания, но без возможности его поменять.
   *
   * `status` не задаётся вовсе — колонка по умолчанию даёт `approved`:
   * администратор публикует без чужого одобрения, потому что одобряет он сам.
   */
  async create(dto: CreateBannerDto) {
    const sortOrder =
      dto.sortOrder ?? (await this.repository.maxSortOrder()) + 1;

    return this.repository.create({
      title: dto.title,
      photoRu: dto.photoRu,
      photoUzLatn: dto.photoUzLatn,
      photoUzCyrl: dto.photoUzCyrl,
      /** `||`, а не `??`: пустая строка из формы — это «без ссылки», как и её отсутствие. */
      linkUrl: dto.linkUrl || null,
      isActive: dto.isActive ?? true,
      sortOrder,
    });
  }

  async update(id: number, dto: UpdateBannerDto) {
    await this.getOrFail(id);

    /**
     * `linkUrl` разбираем отдельно: пустая строка из формы — это «убрать
     * ссылку», а не «сохранить пустую». Спред без этого клал бы в базу '' и
     * баннер оставался кликабельным, ведя в никуда.
     */
    const { linkUrl, ...rest } = dto;

    return this.repository.update(id, {
      ...rest,
      ...(linkUrl === undefined ? {} : { linkUrl: linkUrl || null }),
    });
  }

  async remove(id: number) {
    await this.getOrFail(id);
    await this.repository.delete(id);
  }

  /**
   * Перестановка карусели. Незнакомый id — отказ целиком: применить порядок
   * частично значит молча перемешать список не так, как показала админка.
   *
   * Баннеры продавцов сюда не попадают ни при какой попытке: `findAll()`
   * отдаёт только площадочные, и чужой id отсеется проверкой «Баннеры не
   * найдены» — той же, что ловит опечатку.
   */
  async reorder(ids: number[]) {
    const unique = [...new Set(ids)];
    if (unique.length !== ids.length) {
      throw new BadRequestException('В порядке есть повторяющиеся id');
    }

    const existing = await this.repository.findAll();
    const known = new Set(existing.map((b) => b.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length) {
      throw new BadRequestException(
        `Баннеры не найдены: ${unknown.join(', ')}`,
      );
    }

    await this.repository.applyOrder(ids);
    return this.repository.findAll();
  }

  /**
   * Кабинет продавца: его баннеры вместе со всей модерацией.
   *
   * Гейта тарифа здесь нет намеренно, хотя на создании и правке он есть.
   * Подписка кончилась — баннер никуда не делся, он просто не показывается, и
   * продавец обязан видеть, что у него лежит и почему: иначе после продления
   * на главной появится картинка, о существовании которой он забыл. Чтение
   * собственной строки не стоит площадке ничего.
   */
  async findForShop(ownerId: number) {
    const shop = await this.shopsService.getActiveOwnShopOrThrow(ownerId);
    return this.repository.findOwned(shop.id);
  }

  /**
   * Заявка продавца на баннер.
   *
   * Тариф — только через `effectiveLimits` (правило B4):
   * `shops.subscription_plan` намеренно остаётся `'max'` после истечения
   * срока, и прямое сравнение с ним выдало бы баннер магазину, переставшему
   * платить полгода назад.
   *
   * `status: 'pending'` ставит код, а не колонка: у колонки значение по
   * умолчанию `approved`, и оно правильное — иначе накат миграции уронил бы в
   * очередь на проверку всю нынешнюю карусель площадки.
   */
  async createForShop(ownerId: number, dto: CreateShopBannerDto) {
    const shop = await this.shopsService.getActiveOwnShopOrThrow(ownerId);

    const slots = effectiveLimits(shop).bannerSlots;
    if (slots <= 0) {
      throw new ForbiddenException(PLAN_REQUIRED);
    }

    /**
     * Текст ответа написан под сегодняшний MAX с одним слотом. Появится тариф
     * с несколькими — фразу придётся менять вместе с числом: «баннер уже
     * загружен» при четырёх слотах читается как ошибка площадки.
     */
    const used = await this.repository.countOwned(shop.id);
    if (used >= slots) {
      throw new ConflictException(
        'Баннер уже загружен — отредактируйте существующий',
      );
    }

    await this.assertPhotosExist(dto);

    return this.repository.create({
      shopId: shop.id,
      title: dto.title,
      photoRu: dto.photoRu,
      photoUzLatn: dto.photoUzLatn,
      photoUzCyrl: dto.photoUzCyrl,
      linkUrl: dto.linkUrl || null,
      status: 'pending',
      /**
       * Этими двумя полями продавец не распоряжается (их нет в его DTO), но
       * строке они нужны: `isActive` — потому что «загрузил, но не показываю»
       * здесь не имеет смысла, `sortOrder` — потому что порядок баннеров
       * продавцов задаёт ротация, и общий ноль означает «поле не участвует».
       */
      isActive: true,
      sortOrder: 0,
    });
  }

  /**
   * Правка своего баннера.
   *
   * Гейт тарифа стоит и здесь, а не только на создании: без него магазин с
   * истёкшей подпиской продолжал бы держать баннер живым — поправил картинку,
   * прошёл модерацию, и строка снова готова к показу, хотя платить перестали.
   *
   * **Любая правка возвращает баннер в `pending` и стирает след прошлой
   * модерации.** Без этого проверка обходится в одно действие: показали
   * приличную картинку, получили одобрение, подменили `photoRu` — и на главной
   * висит то, чего никто не видел. `rejectReason`, `moderatedBy` и
   * `moderatedAt` чистятся вместе со статусом: причина отказа по картинке,
   * которой уже нет, вводит в заблуждение и продавца, и следующего модератора.
   */
  async updateOwn(ownerId: number, id: number, dto: UpdateShopBannerDto) {
    const shop = await this.shopsService.getActiveOwnShopOrThrow(ownerId);

    if (effectiveLimits(shop).bannerSlots <= 0) {
      throw new ForbiddenException(PLAN_REQUIRED);
    }

    const banner = await this.repository.findOwnedByIdAndShop(id, shop.id);
    if (!banner) {
      throw new NotFoundException('Баннер не найден');
    }

    await this.assertPhotosExist(dto);

    /** Разбор пустой строки — тот же, что у админской правки. */
    const { linkUrl, ...rest } = dto;

    return this.repository.update(id, {
      ...rest,
      ...(linkUrl === undefined ? {} : { linkUrl: linkUrl || null }),
      status: 'pending',
      rejectReason: null,
      moderatedBy: null,
      moderatedAt: null,
    });
  }

  /**
   * Удаление своего баннера.
   *
   * Гейта тарифа нет и быть не должно: убрать за собой продавец вправе всегда,
   * в том числе когда подписка кончилась. Отказ на этом месте оставил бы
   * человека с картинкой, которую он не может ни показать, ни удалить.
   */
  async removeOwn(ownerId: number, id: number) {
    const shop = await this.shopsService.getActiveOwnShopOrThrow(ownerId);

    const banner = await this.repository.findOwnedByIdAndShop(id, shop.id);
    if (!banner) {
      throw new NotFoundException('Баннер не найден');
    }

    await this.repository.delete(id);
  }

  /** Очередь модерации для администратора. */
  async findShopBannersForAdmin(query: FindShopBannersQueryDto) {
    const { data, total, page, limit } =
      await this.repository.findShopBanners(query);
    return buildPaginatedResult(data, total, page, limit);
  }

  /**
   * Решение администратора по баннеру продавца.
   *
   * Отказ без причины запрещён: причину читает продавец, и «не одобрено» молча
   * — это гарантированная переписка с поддержкой вместо исправленной картинки.
   * Проверка живёт здесь, а не в декораторах DTO, потому что это зависимость
   * поля от поля (разбор — в докблоке `ModerateBannerDto`).
   *
   * При одобрении `rejectReason` чистится: старая причина рядом с одобренным
   * баннером выглядит как противоречие, а хранить её незачем — история решений
   * ведётся не здесь.
   *
   * Уведомления уходят в двух каналах и оба — не дожидаясь ответа: ни телеграм,
   * ни push не должны решать судьбу запроса. Упавшая отправка останется в логе,
   * тогда как отказ из-за неё заставил бы администратора нажать кнопку второй
   * раз, отправив второе решение по уже решённому баннеру.
   */
  async moderate(id: number, dto: ModerateBannerDto, adminId: number) {
    const banner = await this.repository.findShopBannerById(id);
    if (!banner) {
      throw new NotFoundException('Баннер не найден');
    }

    let rejectReason: string | null = null;
    if (dto.status === 'rejected') {
      const reason = dto.reason?.trim();
      if (!reason) {
        throw new BadRequestException('Укажите причину отказа');
      }
      rejectReason = reason;
    }

    const updated = await this.repository.update(id, {
      status: dto.status,
      rejectReason,
      moderatedBy: adminId,
      moderatedAt: new Date(),
    });

    this.notifyOwner(banner.shopOwner, id, rejectReason);

    return { ...updated, shopName: banner.shopName };
  }

  /**
   * Существуют ли картинки, на которые ссылается продавец.
   *
   * Проверка нужна только здесь: администратору ключи подставляет та же форма,
   * что их загрузила, а продавец ходит в API и через curl — прислав случайный
   * uuid, он получил бы битую карусель на главной, и заметил бы это не он, а
   * покупатель. `@IsUUID('4')` ловит только форму строки, но не существование
   * файла.
   *
   * Размеры картинки при этом не проверяются вовсе — разбор в докблоке
   * `BANNER_FORMATS`. Отсюда разделение труда: битую ссылку ловит эта
   * проверка, неподходящую картинку — модерация.
   *
   * Ключи прогоняются через `Set`: в трёх языках нередко лежит одна и та же
   * картинка, и три одинаковых HEAD-запроса в S3 — это две лишних поездки.
   * `Promise.all` вместо цикла: запросы независимы, складывать их задержки
   * незачем.
   */
  private async assertPhotosExist(dto: {
    photoRu?: string;
    photoUzLatn?: string;
    photoUzCyrl?: string;
  }): Promise<void> {
    const keys = [
      ...new Set([dto.photoRu, dto.photoUzLatn, dto.photoUzCyrl]),
    ].filter((key): key is string => typeof key === 'string');

    if (keys.length === 0) return;

    const found = await Promise.all(keys.map((key) => this.files.exists(key)));
    if (found.includes(false)) {
      throw new BadRequestException(
        'Изображение не загружено — повторите загрузку файла',
      );
    }
  }

  /**
   * Сообщить продавцу решение по баннеру.
   *
   * Оба канала намеренно: чата с ботом может не быть, зато открыта вкладка
   * сайта, и наоборот. Дубль на двух устройствах — меньшее зло, чем продавец,
   * неделю ждущий баннер, отклонённый в первый час.
   *
   * `catch` на обоих вызовах, хотя оба и так гасят ошибки внутри: это защита от
   * того, что кто-то однажды перестанет их гасить. Необработанное отклонение в
   * Node роняет процесс целиком — цена ошибки несопоставима с ценой строки.
   */
  private notifyOwner(
    ownerId: number,
    bannerId: number,
    rejectReason: string | null,
  ): void {
    const approved = rejectReason === null;

    const text = approved
      ? '✅ <b>Баннер одобрен</b>\n\n' +
        'Он уже показывается в карусели на главной странице.'
      : '🚫 <b>Баннер не одобрен</b>\n\n' +
        `Причина: ${escapeHtml(excerpt(rejectReason))}\n\n` +
        'Поправьте его в разделе «Баннер» — он снова уйдёт на проверку.';

    this.notifications
      .notifyUser(ownerId, text)
      .catch((err: unknown) => this.logNotifyFailure('telegram', ownerId, err));

    this.notifications
      .pushToUser(ownerId, {
        title: approved ? 'Баннер одобрен' : 'Баннер не одобрен',
        body: approved
          ? 'Баннер показывается на главной странице'
          : excerpt(rejectReason, 120),
        url: SELLER_BANNER_PATH,
        tag: `banner-${bannerId}`,
      })
      .catch((err: unknown) => this.logNotifyFailure('push', ownerId, err));
  }

  private logNotifyFailure(
    channel: string,
    ownerId: number,
    err: unknown,
  ): void {
    this.logger.error(
      `Решение по баннеру не доставлено (${channel}) пользователю ${ownerId}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }

  private async getOrFail(id: number) {
    const banner = await this.repository.findById(id);
    if (!banner) {
      throw new NotFoundException('Баннер не найден');
    }
    return banner;
  }
}
