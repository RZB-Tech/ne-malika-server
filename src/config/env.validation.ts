import { plainToInstance } from 'class-transformer';
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
