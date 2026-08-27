import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import {
  BANNER_MODERATION_STATUSES,
  type BannerModerationStatus,
} from '../banners.constants';
import { PublicBannerDto } from './public-banner.dto';

/**
 * Баннер как его видят те, кто им управляет: продавец в своём кабинете и
 * администратор в админке.
 *
 * Наследует публичные поля и добавляет две группы. Первая — управление
 * (`isActive`, `sortOrder`): его видит и меняет только владелец карусели.
 * Вторая — модерация, и она нужна обоим: продавцу, чтобы понять, почему баннер
 * не показывается, администратору — чтобы помнить, что он уже решил.
 *
 * `isActive` и `status` не слиты в одно поле сознательно: первое — «владелец
 * включил», второе — «модерация пропустила». Витрине нужны оба, и в интерфейсе
 * они показываются раздельно, иначе отклонённый, но включённый продавцом
 * баннер выглядел бы ошибкой площадки.
 *
 * Новые поля объявлены с явным `type`: по объявлению `string | null` рефлексия
 * отдаёт `Object`, и на клиенте поле приезжает `unknown` — та же причина, по
 * которой это сделано у `linkUrl`.
 */
export class BannerDto extends PublicBannerDto {
  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: 0 })
  sortOrder: number;

  /**
   * Чей баннер. `null` — площадочный, заведён администратором. Клиенту поле
   * нужно, чтобы админка отличала карусель площадки от очереди модерации, а
   * кабинет продавца не предлагал правку чужой строки.
   */
  @ApiProperty({ type: Number, nullable: true, example: 12 })
  shopId: number | null;

  /**
   * Состояние модерации. У площадочных всегда `approved`: администратор
   * публикует без чужого одобрения — одобряет он сам.
   */
  @ApiProperty({ enum: BANNER_MODERATION_STATUSES, example: 'pending' })
  status: BannerModerationStatus;

  /** Причина отказа — её читает продавец, поэтому написана человеческим языком. */
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Текст акции обрезан по правому краю',
  })
  rejectReason: string | null;

  /** Когда принято решение. `null` — баннер ещё ждёт очереди. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  moderatedAt: Date | null;

  @ApiPropertyOptional({ format: 'date-time' })
  createdAt?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  updatedAt?: string;
}

/**
 * То же плюс название магазина.
 *
 * Название приезжает join'ом, а не вторым запросом на строку: без него очередь
 * модерации — это столбик id, по которому администратор всё равно пойдёт
 * искать магазин руками. Отдельный класс, а не необязательное поле в
 * `BannerDto`, потому что продавцу название собственного магазина сообщать
 * незачем, а необязательное поле в общем DTO заставляет клиента гадать, когда
 * оно есть.
 */
export class AdminBannerDto extends BannerDto {
  @ApiProperty({ example: 'ТехноМаркет' })
  shopName: string;
}

/**
 * Страница очереди модерации. Класс объявлен ради Swagger: `PaginatedResult<T>`
 * — интерфейс, дженерики в спеку не попадают, и без него клиент получил бы
 * ответ без типа.
 */
export class PaginatedShopBannersDto {
  @ApiProperty({ type: [AdminBannerDto] })
  data: AdminBannerDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
