import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { subscriptionPlanEnum } from '../../../db/schema';
import type { SubscriptionPlanId } from '../subscriptions.constants';

const PLAN_VALUES = [...subscriptionPlanEnum.enumValues];

/**
 * Фильтры админского списка подписок.
 *
 * Имена в змеином регистре (`expiring_days`, `needs_review`) — как у остальных
 * админских выдач репозитория (`shop_id` в жалобах, `product_id` в отзывах):
 * это параметры строки запроса, и переименовывать их в camelCase ради красоты
 * значило бы сломать уже написанные ссылки в админке.
 */
export class FindAdminSubscriptionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: PLAN_VALUES,
    description:
      'ДЕЙСТВУЮЩИЙ тариф, а не записанный в магазине: `max` вернёт только ' +
      'тех, у кого он ещё оплачен, а `free` — всех остальных, включая ' +
      'просроченных бывших подписчиков',
  })
  @IsOptional()
  @IsIn(PLAN_VALUES)
  plan?: SubscriptionPlanId;

  @ApiPropertyOptional({
    description: 'Поиск по названию магазина, контакту или владельцу',
    example: 'техно',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 90,
    description:
      'Показать только тех, у кого подписка ещё жива и истекает в ' +
      'ближайшие N суток. `0` — истекает сегодня',
    example: 7,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(90)
  expiring_days?: number;

  @ApiPropertyOptional({
    description:
      'Только магазины с платежами, помеченными «требует разбора»: деньги ' +
      'списаны, а автоматика не довела дело до конца (Д3)',
  })
  @IsOptional()
  /**
   * Строка запроса приходит текстом, и `IsBoolean` без приведения отверг бы
   * `?needs_review=true` целиком. Приводим только два известных написания:
   * всё прочее оставляем строкой, и валидатор честно отвечает 400, вместо
   * того чтобы молча счесть `?needs_review=0` включённым фильтром.
   */
  @Transform(({ value }: { value: unknown }): unknown =>
    value === 'true' || value === true
      ? true
      : value === 'false' || value === false
        ? false
        : value,
  )
  @IsBoolean()
  needs_review?: boolean;
}
