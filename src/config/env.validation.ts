import {
  plainToInstance,
  Transform,
  TransformFnParams,
} from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateIf,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * Приводит числовую переменную к числу, считая пустую строку отсутствием.
 *
 * Зачем вообще: `validate()` идёт с `enableImplicitConversion`, и для поля,
 * объявленного как `number`, class-transformer зовёт `Number(value)`. А
 * `Number('')` — это ноль, не `NaN`. Строка `SUBSCRIPTION_PRICE_START_UZS=`
 * (именно так в `.env.example` выглядит незаполненный ключ) превратилась бы в
 * `0` и уронила старт на `@Min(1)` сообщением «не меньше 1» — по нему причину
 * не найдёшь, переменная-то на вид выставлена. Возвращая `undefined`, отдаём
 * поле `@IsOptional()`, и умолчание спокойно подставит `configuration.ts`.
 *
 * Почему читаем `obj[key]`, а не готовый `value`: собственный `@Transform`
 * применяется ПОСЛЕ неявной конвертации (там же, в `TransformOperationExecutor`,
 * сначала `transform`, затем `applyCustomTransformations`), то есть в `value`
 * пришёл бы уже испорченный ноль. Зато `obj` — нетронутый исходный объект.
 *
 * Почему приводим к числу сами, а не полагаемся на ту же неявную конвертацию:
 * она работает от `design:type`, который эмитит только `tsc`. Тесты идут через
 * `tsx` (внутри esbuild), метаданных декораторов там нет вовсе — без явного
 * приведения `'65000'` осталось бы строкой, и `@IsInt()` в тестах и в бою
 * проверял бы разное.
 */
function optionalInt({ obj, key }: TransformFnParams): unknown {
  const raw: unknown = (obj as Record<string, unknown>)[key];
  if (typeof raw !== 'string') return raw;
  const text = raw.trim();
  return text.length === 0 ? undefined : Number(text);
}

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment;

  @IsInt()
  @Min(0)
  PORT: number;

  @IsString()
  API_PREFIX: string;

  /**
   * Origin'ы через запятую: "https://nemalika.uz,https://www.nemalika.uz".
   * В проде обязателен — запросы идут с credentials, открывать CORS всем нельзя.
   */
  @ValidateIf(
    (env: EnvironmentVariables) => env.NODE_ENV === Environment.Production,
  )
  @IsString()
  @IsNotEmpty({ message: 'CORS_ORIGINS обязателен в production' })
  CORS_ORIGINS?: string;

  @IsString()
  DATABASE_URL: string;

  /** Без него кэш просто выключается — приложение работает напрямую с БД. */
  @IsOptional()
  @IsString()
  REDIS_URL?: string;

  /** Без него не работают ИИ-проверка товаров и составление промпта. */
  @IsOptional()
  @IsString()
  OPENROUTER_API_KEY?: string;

  @IsOptional()
  @IsString()
  OPENROUTER_MODEL?: string;

  @IsOptional()
  @IsString()
  OPENROUTER_VISION_MODEL?: string;

  /** Автозаполнение карточки: нужна зрячая модель, разбирающая надписи на фото. */
  @IsOptional()
  @IsString()
  OPENROUTER_AUTOFILL_MODEL?: string;

  @IsOptional()
  @IsString()
  OPENROUTER_IMAGE_MODEL?: string;

  /** ИИ-сравнение товаров: бесплатное для покупателей, поэтому самое дешёвое. */
  @IsOptional()
  @IsString()
  OPENROUTER_COMPARE_MODEL?: string;

  @IsOptional()
  @IsString()
  OPENROUTER_BASE_URL?: string;

  @IsString()
  JWT_ACCESS_SECRET: string;

  @IsString()
  @Matches(/^\d+(?:ms|s|m|h|d|w|y)$/, {
    message: 'JWT_ACCESS_TTL must be a duration such as 900s or 15m',
  })
  JWT_ACCESS_TTL: string;

  @IsString()
  JWT_REFRESH_SECRET: string;

  @IsString()
  @Matches(/^\d+(?:ms|s|m|h|d|w|y)$/, {
    message: 'JWT_REFRESH_TTL must be a duration such as 30d',
  })
  JWT_REFRESH_TTL: string;

  @IsOptional()
  @IsString()
  TELEGRAM_BOT_TOKEN?: string;

  @IsInt()
  TELEGRAM_INIT_DATA_TTL_SEC: number;

  @IsOptional()
  @IsString()
  TELEGRAM_WEBHOOK_URL?: string;

  /**
   * Секрет заголовка X-Telegram-Bot-Api-Secret-Token. В проде обязателен:
   * эндпоинт вебхука публичный, и без секрета кто угодно прислал бы
   * поддельный апдейт от чужого имени.
   */
  @ValidateIf(
    (env: EnvironmentVariables) => env.NODE_ENV === Environment.Production,
  )
  @IsString()
  @IsNotEmpty({ message: 'TELEGRAM_WEBHOOK_SECRET обязателен в production' })
  TELEGRAM_WEBHOOK_SECRET?: string;

  /** Ключи web push. Без них канал выключен — рассылка уходит только в Telegram. */
  @IsOptional()
  @IsString()
  VAPID_PUBLIC_KEY?: string;

  @IsOptional()
  @IsString()
  VAPID_PRIVATE_KEY?: string;

  @IsOptional()
  @IsString()
  VAPID_SUBJECT?: string;

  @IsOptional()
  @IsString()
  S3_ENDPOINT?: string;

  @IsString()
  S3_REGION: string;

  @IsString()
  S3_BUCKET: string;

  @ValidateIf(
    (env: EnvironmentVariables) =>
      hasText(env.S3_ACCESS_KEY) || hasText(env.S3_SECRET_KEY),
  )
  @IsString()
  @IsNotEmpty({ message: 'S3_ACCESS_KEY is required with S3_SECRET_KEY' })
  S3_ACCESS_KEY?: string;

  @ValidateIf(
    (env: EnvironmentVariables) =>
      hasText(env.S3_ACCESS_KEY) || hasText(env.S3_SECRET_KEY),
  )
  @IsString()
  @IsNotEmpty({ message: 'S3_SECRET_KEY is required with S3_ACCESS_KEY' })
  S3_SECRET_KEY?: string;

  @IsOptional()
  @IsString()
  S3_PUBLIC_BASE?: string;

  /**
   * Реквизиты Click (оплата подписки магазина).
   *
   * Все — `@IsOptional()`: стенд без платёжных ключей обязан подниматься.
   * Ручка оплаты в таком виде отвечает 503, подписка выдаётся вручную из
   * админки, остальная площадка не замечает разницы. Обязательными их сделать
   * нельзя ещё и технически: `validate()` идёт с `skipMissingProperties: false`,
   * и переменная без `@IsOptional()` роняет старт везде, где её не прописали.
   *
   * Признаком «Click включён» выбран `CLICK_SERVICE_ID`, а не `CLICK_MERCHANT_ID`:
   * service_id участвует и в подписи колбэка, и в адресе кассы — без него не
   * работает ничего, тогда как merchant_id нужен только для ссылки.
   */
  @IsOptional()
  @IsString()
  CLICK_MERCHANT_ID?: string;

  @IsOptional()
  @IsString()
  CLICK_SERVICE_ID?: string;

  /**
   * Секрет из кабинета Click — один на оба интерфейса: и подпись колбэков
   * SHOP API, и заголовок `Auth` Merchant API считаются от него. Обязателен,
   * как только Click включён: без него проверка подписи отвергнет любой
   * колбэк — деньги у плательщика списаны, подписка не выдана, и узнаем мы об
   * этом от продавца, а не из логов.
   *
   * Пустая строка считается отсутствием (`hasText`), как и у ключей S3:
   * `CLICK_SERVICE_ID=` в скопированном `.env.example` — это невыставленный
   * ключ, а не включённый Click без секрета.
   */
  @ValidateIf((env: EnvironmentVariables) => hasText(env.CLICK_SERVICE_ID))
  @IsString()
  @IsNotEmpty({
    message: 'CLICK_SECRET_KEY обязателен вместе с CLICK_SERVICE_ID',
  })
  CLICK_SECRET_KEY?: string;

  /**
   * Идентификатор пользователя кабинета — вторая половина заголовка `Auth`
   * Merchant API, единственного способа вернуть уже списанные деньги, когда
   * выдать подписку не удалось. В production обязателен вместе с остальным
   * Click: принимать оплату, не умея её вернуть, нельзя. Вне production
   * необязателен — там возврат боевых денег и не случается, а требовать боевые
   * реквизиты на каждом стенде значит их туда и разложить.
   *
   * Пары к нему нет: секрет у Merchant API тот же `CLICK_SECRET_KEY`. Отдельная
   * переменная под «секрет Merchant API» здесь была и оказалась выдумкой —
   * Click такого значения не выдаёт, и заполнить её было нечем.
   */
  @ValidateIf(
    (env: EnvironmentVariables) =>
      env.NODE_ENV === Environment.Production && hasText(env.CLICK_SERVICE_ID),
  )
  @IsString()
  @IsNotEmpty({
    message:
      'CLICK_MERCHANT_USER_ID обязателен в production вместе с CLICK_SERVICE_ID',
  })
  CLICK_MERCHANT_USER_ID?: string;

  @IsOptional()
  @IsString()
  CLICK_MERCHANT_API_URL?: string;

  /**
   * Таймаут запроса возврата. Нижняя граница — секунда: возврат идёт наружу, в
   * чужой API, и значение вроде 200 мс означало бы гарантированный отказ по
   * таймауту на каждой попытке, то есть невозвращённые деньги при полностью
   * рабочем Merchant API.
   */
  @Transform(optionalInt)
  @IsOptional()
  @IsInt()
  @Min(1000)
  CLICK_REVERSAL_TIMEOUT_MS?: number;

  @IsOptional()
  @IsString()
  CLICK_RETURN_URL?: string;

  /**
   * Прайс подписки в сумах. Умолчания — в `configuration.ts`, здесь только
   * проверка вменяемости: цена обязана быть целым положительным числом.
   *
   * Ноль отдельно запрещён `@Min(1)`, и не формальности ради: тариф в колбэке
   * определяется по сумме платежа, а нулевая цена совпала бы с нулевой суммой
   * и раздавала бы подписку бесплатно.
   *
   * Попарную различность трёх цен здесь не проверить: часть из них может быть
   * не задана, и совпадение проявится только после подстановки умолчаний.
   * Эту сверку делает `SubscriptionsService` при старте — над собранной
   * таблицей тарифов.
   */
  @Transform(optionalInt)
  @IsOptional()
  @IsInt()
  @Min(1)
  SUBSCRIPTION_PRICE_START_UZS?: number;

  @Transform(optionalInt)
  @IsOptional()
  @IsInt()
  @Min(1)
  SUBSCRIPTION_PRICE_PRO_UZS?: number;

  @Transform(optionalInt)
  @IsOptional()
  @IsInt()
  @Min(1)
  SUBSCRIPTION_PRICE_MAX_UZS?: number;
}

function hasText(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(
      `Config validation error:\n${errors
        .map((e) => Object.values(e.constraints ?? {}).join(', '))
        .join('\n')}`,
    );
  }
  return validatedConfig;
}
