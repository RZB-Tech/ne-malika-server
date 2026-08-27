import { ApiProperty } from '@nestjs/swagger';
import {
  paymentProviderEnum,
  paymentStatusEnum,
  subscriptionPlanEnum,
} from '../../../db/schema';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import type { PaidPlan, SubscriptionPlanId } from '../subscriptions.constants';

const PLAN_VALUES = [...subscriptionPlanEnum.enumValues];
const PAYMENT_STATUS_VALUES = [...paymentStatusEnum.enumValues];
const PAYMENT_PROVIDER_VALUES = [...paymentProviderEnum.enumValues];

export class SubscriptionPlanDto {
  @ApiProperty({
    enum: ['start', 'pro', 'max'],
    description:
      'Идентификатор тарифа. `free` не продаётся и в прайс не входит',
  })
  id: PaidPlan;

  @ApiProperty({ description: 'Цена в сумах', example: 65000 })
  priceUzs: number;

  @ApiProperty({ description: 'Срок в календарных месяцах', example: 1 })
  months: number;

  @ApiProperty({
    description: 'Сколько кредитов на ИИ выдаётся при каждой оплате',
    example: 3000,
  })
  credits: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Бесплатных автозаполнений карточки в календарный месяц. ' +
      '`null` — без ограничения',
    example: 5,
  })
  freeAutofills: number | null;

  @ApiProperty({
    description: 'Поднимает ли тариф товары магазина в общей выдаче',
  })
  promoted: boolean;

  @ApiProperty({ description: 'Сколько баннеров можно держать одновременно' })
  bannerSlots: number;

  @ApiProperty({ description: 'Глубина аналитики в днях', example: 30 })
  analyticsDays: number;
}

export class SubscriptionAutofillDto {
  @ApiProperty({
    description: 'Следующее нажатие бесплатно — по норме либо по безлимиту',
  })
  free: boolean;

  @ApiProperty({ description: 'Тариф даёт автозаполнение без счётчика' })
  unlimited: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Остаток бесплатных попыток в этом месяце. `null` — счётчика нет: ' +
      'либо безлимит, либо тариф бесплатных попыток не даёт вовсе',
  })
  left: number | null;

  @ApiProperty({
    description:
      'Размер месячной нормы у тарифа, который её даёт (START). ' +
      'Показывается и тем, у кого её нет: это часть описания тарифа',
  })
  limit: number;

  @ApiProperty({
    description: 'Когда норма обновится — первое число следующего месяца',
    example: '2026-09-01',
  })
  resetsAt: string;
}

export class SellerSubscriptionDto {
  @ApiProperty({
    enum: PLAN_VALUES,
    description:
      'ДЕЙСТВУЮЩИЙ тариф. У просроченной подписки здесь `free`, даже если ' +
      'в магазине по-прежнему записан оплаченный когда-то `max`',
  })
  plan: SubscriptionPlanId;

  @ApiProperty({ description: 'Подписка оплачена и срок ещё не вышел' })
  active: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'До какого момента оплачено. `null` — не платили ни разу',
  })
  until: Date | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Полных суток до истечения, вверх. `null` у магазина без подписки',
  })
  daysLeft: number | null;

  @ApiProperty({
    description:
      'Кредиты, выданные подпиской, как они лежат в магазине — включая ' +
      'запертые истёкшим тарифом: они не сгорели, но потратить их нельзя',
  })
  subscriptionCredits: number;

  @ApiProperty({ description: 'Купленные и подаренные кредиты. Не сгорают' })
  creditsBalance: number;

  @ApiProperty({ description: 'Занято выполняющимися сейчас запросами' })
  creditsReserved: number;

  @ApiProperty({
    description:
      'Сколько магазин может потратить прямо сейчас: купленные плюс ' +
      'доступные подписочные минус резерв',
  })
  available: number;

  @ApiProperty({ type: SubscriptionAutofillDto })
  autofill: SubscriptionAutofillDto;

  @ApiProperty({ description: 'Сколько баннеров разрешено тарифом' })
  bannerSlots: number;

  @ApiProperty({ description: 'Глубина аналитики в днях' })
  analyticsDays: number;

  @ApiProperty({ description: 'Товары магазина поднимаются в общей выдаче' })
  promoted: boolean;
}

export class PaymentLinkDto {
  @ApiProperty({ enum: PAYMENT_PROVIDER_VALUES, example: 'click' })
  provider: string;

  @ApiProperty({ enum: ['start', 'pro', 'max'] })
  plan: PaidPlan;

  @ApiProperty({ description: 'Сумма к оплате в сумах' })
  amountUzs: number;

  @ApiProperty({
    description: 'Адрес кассы провайдера — открывается в новой вкладке',
    example: 'https://my.click.uz/services/pay?service_id=...',
  })
  url: string;
}

export class TestPaymentLinkDto {
  @ApiProperty({ description: 'Сумма проверки в сумах', example: 1000 })
  amountUzs: number;

  @ApiProperty({
    description:
      'До какого момента открыто окно: позже эта же сумма будет отбита кодом -2',
    example: '2026-08-27T14:35:00.000Z',
  })
  armedUntil: string;

  @ApiProperty({
    description: 'Адрес кассы провайдера — открывается в новой вкладке',
    example: 'https://my.click.uz/services/pay?service_id=...',
  })
  url: string;
}

export class SubscriptionPaymentDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: PAYMENT_PROVIDER_VALUES })
  provider: string;

  @ApiProperty({
    enum: PLAN_VALUES,
    description:
      'Тариф, за который заплатили. Снимок на момент оплаты: тариф магазина ' +
      'с тех пор мог поменяться',
  })
  plan: SubscriptionPlanId;

  @ApiProperty({ description: 'Сумма платежа в сумах' })
  amount: number;

  @ApiProperty({ enum: PAYMENT_STATUS_VALUES })
  status: string;

  @ApiProperty({
    description: 'Номер счёта — его же видит плательщик в чеке провайдера',
  })
  merchantBillingId: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Начало оплаченного периода',
  })
  activatedFrom: Date | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Конец оплаченного периода',
  })
  activatedUntil: Date | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Сколько подписочных кредитов выдал платёж',
  })
  grantedCredits: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Сколько неиспользованных подписочных кредитов сгорело при выдаче',
  })
  burnedCredits: number | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  paidAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Комментарий к ручной активации или отмене',
  })
  note: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Что сообщил провайдер, отменяя платёж',
  })
  errorNote: string | null;

  @ApiProperty({ description: 'Деньги возвращены плательщику' })
  reversed: boolean;

  @ApiProperty({
    description:
      'Возврат инициировал сам провайдер уже после выдачи подписки. ' +
      'Период при этом не отзывается автоматически',
  })
  refundedByProvider: boolean;

  @ApiProperty({
    description: 'Платёж ждёт разбора человеком: автоматика не справилась',
  })
  needsManualReview: boolean;
}

export class PaginatedSubscriptionPaymentsDto {
  @ApiProperty({ type: [SubscriptionPaymentDto] })
  data: SubscriptionPaymentDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

export class AdminSubscriptionRowDto {
  @ApiProperty()
  shopId: number;

  @ApiProperty()
  shopName: string;

  @ApiProperty({ description: 'Статус самого магазина: активен или упразднён' })
  shopStatus: string;

  @ApiProperty()
  ownerId: number;

  @ApiProperty()
  ownerName: string;

  @ApiProperty({ type: String, nullable: true })
  ownerUsername: string | null;

  @ApiProperty({
    enum: PLAN_VALUES,
    description: 'ДЕЙСТВУЮЩИЙ тариф: у просроченной подписки здесь `free`',
  })
  plan: SubscriptionPlanId;

  @ApiProperty({
    enum: PLAN_VALUES,
    description:
      'Тариф, записанный в магазине. У просроченной подписки остаётся ' +
      'прежним — так видно, чем магазин пользовался',
  })
  storedPlan: SubscriptionPlanId;

  @ApiProperty({ description: 'Подписка оплачена и срок ещё не вышел' })
  active: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  until: Date | null;

  @ApiProperty({ type: Number, nullable: true })
  daysLeft: number | null;

  @ApiProperty({ description: 'Подписочные кредиты магазина' })
  subscriptionCredits: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Когда прошла последняя успешная оплата',
  })
  lastPaidAt: Date | null;

  @ApiProperty({
    description:
      'Есть платёж, застрявший в `prepared` дольше суток: касса открыта, ' +
      'подтверждение не пришло. Денег там нет — Prepare ничего не списывает',
  })
  stuckPrepared: boolean;

  @ApiProperty({
    description:
      'Есть платёж с отметкой «требует разбора»: деньги списаны, а довести ' +
      'дело до конца автоматика не смогла',
  })
  needsManualReview: boolean;
}

export class PaginatedAdminSubscriptionsDto {
  @ApiProperty({ type: [AdminSubscriptionRowDto] })
  data: AdminSubscriptionRowDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
