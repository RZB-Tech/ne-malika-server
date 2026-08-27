import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Протокол Click: подпись, разбор колбэка, заголовок Merchant API, ссылка на
 * кассу.
 *
 * Чистые функции над строками, без Nest и без базы. Так они, во-первых,
 * проверяются тестом напрямую (`click-protocol.spec.ts`) — а это денежный
 * путь, где ошибка в подписи означает либо отбитые платежи, либо принятые
 * чужие; во-вторых, их можно звать из контроллера до всякой транзакции, чтобы
 * отбраковать мусор раньше, чем он дойдёт до строки платежа.
 *
 * Перенос проверенного в бою кода: состав строк подписи и порядок полей взяты
 * из документации Click и сверены с официальной библиотекой click-llc.
 * Менять здесь что-либо «для красоты» нельзя — любая перестановка полей
 * ломает сверку подписи целиком, и выяснится это на живых платежах.
 */

/**
 * Коды ответов SHOP API.
 *
 * Тексты — по-английски, как в документации Click, и в переводы их выносить
 * нельзя: читает их не человек, а робот провайдера, и сверка идёт по строке.
 * Ровно поэтому же они собраны таблицей, а не разбросаны литералами по
 * контроллеру: пара «код + текст» обязана оставаться неразрывной.
 */
export const CLICK_RESPONSE = {
  success: { error: 0, note: 'Success' },
  signFailed: { error: -1, note: 'SIGN CHECK FAILED!' },
  invalidAmount: { error: -2, note: 'Incorrect parameter amount' },
  actionNotFound: { error: -3, note: 'Action not found' },
  alreadyPaid: { error: -4, note: 'Already paid' },
  userNotFound: { error: -5, note: 'User does not exist' },
  transactionNotFound: { error: -6, note: 'Transaction does not exist' },
  updateFailed: { error: -7, note: 'Failed to update user' },
  invalidRequest: { error: -8, note: 'Error in request from click' },
  cancelled: { error: -9, note: 'Transaction cancelled' },
} as const;

/**
 * Стадия двухфазного протокола: 0 — Prepare (Click спрашивает, примем ли мы
 * счёт; денег ещё никто не трогал), 1 — Complete (деньги списаны, пора
 * выдавать оплаченное).
 */
export type ClickAction = 0 | 1;

/** Разобранное и проверенное по формату тело колбэка. */
export interface ClickCallback {
  clickTransId: string;
  clickPaydocId: string;
  serviceId: string;
  merchantTransId: string;
  /** Пуст на Prepare, обязателен и числовой на Complete. */
  merchantPrepareId: string;
  amount: number;
  /**
   * Сумма ровно тем текстом, каким её прислали. Нужна сверх числа, потому что
   * в строку подписи входит именно она: `15000.00` и `15000` дают одно число
   * и разные md5, и пересобрать текст из числа нельзя.
   */
  amountText: string;
  action: ClickAction;
  /**
   * Код от провайдера: 0 — всё в порядке, отрицательный — отмена или возврат
   * на его стороне, положительный — ошибка, о которой он нас уведомляет.
   */
  clickError: number;
  signTime: string;
  signString: string;
}

/**
 * Поле тела строкой.
 *
 * Click присылает form-urlencoded, где всё — текст, но
 * `express.urlencoded({ extended: true })` из `a[b]=1` или повторённого ключа
 * соберёт объект или массив. Это уже не поле протокола, и приводить такое к
 * тексту нельзя: `String({})` даёт `'[object Object]'` — непустую строку,
 * которая прошла бы проверку «`merchant_trans_id` заполнен». Всё, что не
 * примитив, считается отсутствующим; на настоящих колбэках эта ветка не
 * срабатывает ни разу.
 *
 * Экспортируется ради `click.controller.ts`: он читает `action`, `service_id`
 * и `amount` до строгого разбора — чтобы отличить `-3` от `-8` и `-8` от
 * `-2`, — а потом возвращает `click_trans_id` в ответе. Собственное чтение тех
 * же полей однажды разошлось бы с этим, и провайдер получил бы ответ с не тем
 * идентификатором, по которому ищет свою запись.
 */
export function clickField(body: Record<string, unknown>, key: string): string {
  const raw = body[key];
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return '';
}

/**
 * Сравнение за постоянное время. Длину сверяем сами и заранее: `timingSafeEqual`
 * на буферах разной длины не возвращает `false`, а бросает `RangeError`, — а
 * исключение здесь означало бы 500 в ответ на колбэк и повтор запроса от
 * Click вместо честного «подпись не сошлась».
 */
function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

/**
 * Подпись запроса.
 *
 * Состав строки различается по стадии: в Complete между `merchant_trans_id` и
 * `amount` вклинивается `merchant_prepare_id`. Порядок полей — из документации
 * Click, менять его нельзя. Секрет стоит третьим, между `service_id` и
 * `merchant_trans_id`, — не в начале и не в конце, как обычно бывает.
 *
 * md5 здесь не выбор, а требование протокола: Click считает подпись именно им.
 * Подобрать прообраз это не даёт — секрет в середине строки, — но и защиты от
 * подбора самого секрета не добавляет, поэтому ключ обязан быть длинным.
 */
export function createClickSignature(
  body: Record<string, unknown>,
  secretKey: string,
): string {
  const clickTransId = clickField(body, 'click_trans_id');
  const serviceId = clickField(body, 'service_id');
  const merchantTransId = clickField(body, 'merchant_trans_id');
  const merchantPrepareId = clickField(body, 'merchant_prepare_id');
  const amount = clickField(body, 'amount');
  const action = clickField(body, 'action');
  const signTime = clickField(body, 'sign_time');

  const signSource =
    action === '0'
      ? `${clickTransId}${serviceId}${secretKey}${merchantTransId}${amount}${action}${signTime}`
      : `${clickTransId}${serviceId}${secretKey}${merchantTransId}${merchantPrepareId}${amount}${action}${signTime}`;

  return createHash('md5').update(signSource).digest('hex').toLowerCase();
}

/**
 * Сверка подписи.
 *
 * Через `timingSafeEqual`, а не `===`: сравнение строк выходит из цикла на
 * первом различии, и по времени ответа подпись подбирается посимвольно — за
 * сотни запросов вместо перебора всех 16³² вариантов.
 *
 * Пустой секрет — всегда «не сошлась». Иначе стенд с незаполненной переменной
 * окружения принимал бы любой запрос, подписанный пустым ключом, то есть
 * любой запрос от кого угодно.
 */
export function verifyClickSignature(
  body: Record<string, unknown>,
  secretKey: string,
): boolean {
  if (!secretKey) return false;
  return timingSafeStringEqual(
    createClickSignature(body, secretKey),
    clickField(body, 'sign_string').toLowerCase(),
  );
}

function isInteger(valueToCheck: string): boolean {
  return /^-?\d+$/.test(valueToCheck);
}

/**
 * Разбор колбэка. `null` на любом несоответствии формату.
 *
 * Проверки строгие намеренно: числовые идентификаторы обязаны быть числами,
 * подпись — ровно 32 hex, `action` — 0 или 1, сумма — с не более чем двумя
 * знаками после точки. Пропущенная «почти правильная» строка попала бы в
 * `subscription_payments` и в сравнение сумм, где стоила бы либо отказа по
 * оплаченному платежу, либо оплаченного периода не за ту сумму.
 *
 * Разбирать, чего именно не хватило, здесь не нужно: вызывающему хватает
 * `null` плюс отдельная проверка суммы, чтобы выбрать между `-2` и `-8`. Один
 * код на каждую разновидность мусора протокол всё равно не предусматривает.
 *
 * Строгость не распространяется на лишние поля: Click присылает и то, чего
 * нет в документации (`merchant_user_id`, `error_note`, изредка новые), и
 * отбраковка по «незнакомому полю» означала бы сорванный платёж на каждом
 * обновлении у провайдера.
 */
export function parseClickCallback(
  body: Record<string, unknown>,
): ClickCallback | null {
  const clickTransId = clickField(body, 'click_trans_id');
  const clickPaydocId = clickField(body, 'click_paydoc_id');
  const serviceId = clickField(body, 'service_id');
  const merchantTransId = clickField(body, 'merchant_trans_id');
  const merchantPrepareId = clickField(body, 'merchant_prepare_id');
  const amountText = clickField(body, 'amount');
  const actionText = clickField(body, 'action');
  const errorText = clickField(body, 'error');
  const signTime = clickField(body, 'sign_time');
  const signString = clickField(body, 'sign_string');

  if (
    !/^\d+$/.test(clickTransId) ||
    !/^\d+$/.test(clickPaydocId) ||
    !/^\d+$/.test(serviceId) ||
    !merchantTransId ||
    !/^\d+(?:\.\d{1,2})?$/.test(amountText) ||
    !isInteger(actionText) ||
    !isInteger(errorText) ||
    !signTime ||
    !/^[a-f\d]{32}$/i.test(signString)
  ) {
    return null;
  }

  const actionNumber = Number(actionText);
  if (actionNumber !== 0 && actionNumber !== 1) return null;
  /**
   * Complete без `merchant_prepare_id` разобрать нельзя: это номер счёта,
   * который мы сами вернули на Prepare, и без него неизвестно, какой платёж
   * подтверждают. Заодно это и часть строки подписи — принять такой запрос
   * значило бы сверить подпись не с тем, что прислали.
   */
  if (actionNumber === 1 && !/^\d+$/.test(merchantPrepareId)) return null;

  const amount = Number(amountText);
  const clickError = Number(errorText);
  if (
    !Number.isSafeInteger(clickError) ||
    !Number.isFinite(amount) ||
    amount <= 0
  )
    return null;

  return {
    clickTransId,
    clickPaydocId,
    serviceId,
    merchantTransId,
    merchantPrepareId,
    amount,
    amountText,
    action: actionNumber,
    clickError,
    signTime,
    signString: signString.toLowerCase(),
  };
}

/**
 * Заголовок `Auth` для Merchant API: `merchant_user_id:sha1(timestamp+secret):timestamp`.
 *
 * sha1, а не md5, и другой секрет, чем у SHOP API: у Merchant API своя схема,
 * не совпадающая с колбэками ни алгоритмом, ни ключом. Перепутать их — самая
 * дорогая ошибка в этом файле: заметить её можно только в тот момент, когда
 * возврат денег уже понадобился, то есть когда платёж уже сломан.
 *
 * `timestamp` — секунды Unix, и он же уходит в заголовок открытым текстом:
 * провайдер сверяет, что подпись свежая.
 */
export function createClickMerchantAuth(
  merchantUserId: string,
  secretKey: string,
  timestamp: number,
): string {
  const digest = createHash('sha1')
    .update(`${timestamp}${secretKey}`)
    .digest('hex');
  return `${merchantUserId}:${digest}:${timestamp}`;
}

/**
 * Ссылка на кассу Click.
 *
 * `amount` с двумя знаками всегда: касса показывает сумму так, как её
 * прислали, и «65000» вместо «65000.00» рядом с ценой тарифа выглядит другой
 * суммой. `URLSearchParams` — не для красоты: `transaction_param` приходит
 * снаружи и обязан быть закодирован, иначе амперсанд в нём подменил бы
 * остальные параметры ссылки.
 *
 * `return_url` необязателен: без него Click оставит покупателя на своей
 * странице результата, и это рабочее поведение, а не поломка.
 */
export function createClickPaymentUrl(input: {
  serviceId: string;
  merchantId: string;
  amountUzs: number;
  transactionParam: string;
  returnUrl?: string;
}): string {
  const params = new URLSearchParams({
    service_id: input.serviceId,
    merchant_id: input.merchantId,
    amount: input.amountUzs.toFixed(2),
    transaction_param: input.transactionParam,
  });
  if (input.returnUrl) params.set('return_url', input.returnUrl);
  return `https://my.click.uz/services/pay?${params.toString()}`;
}
