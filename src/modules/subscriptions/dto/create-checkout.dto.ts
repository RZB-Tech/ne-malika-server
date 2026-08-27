import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { PAID_PLANS, type PaidPlan } from '../subscriptions.constants';

/**
 * Что покупает продавец.
 *
 * Ни суммы, ни срока в теле нет и быть не может: цену назначает площадка, а
 * срок у всех тарифов один месяц. Пришедшая с клиента сумма означала бы, что
 * подписку можно купить за сумму, набранную в консоли браузера, — и заметили
 * бы мы это по выписке, а не по коду.
 *
 * Список допустимых значений — `PAID_PLANS`: `free` не продаётся, это
 * состояние «подписки нет», а не товар. Копия списка литералом рано или поздно
 * начала бы принимать тариф, которого уже нет в прайсе.
 */
export class CreateCheckoutDto {
  @ApiProperty({
    enum: PAID_PLANS,
    description: 'Тариф, за который платим',
    example: 'pro',
  })
  @IsIn([...PAID_PLANS], { message: 'Неизвестный тариф' })
  plan: PaidPlan;
}
