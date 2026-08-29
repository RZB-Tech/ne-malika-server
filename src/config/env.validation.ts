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
  Max,
  Min,
  ValidateIf,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

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

  @ValidateIf(
    (env: EnvironmentVariables) => env.NODE_ENV === Environment.Production,
  )
  @IsString()
  @IsNotEmpty({ message: 'CORS_ORIGINS обязателен в production' })
  CORS_ORIGINS?: string;

  @IsString()
  DATABASE_URL: string;

  @IsOptional()
  @IsString()
  REDIS_URL?: string;

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
  OPENROUTER_AUTOFILL_MODEL?: string;

  @IsOptional()
  @IsString()
  OPENROUTER_IMAGE_MODEL?: string;

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

  @ValidateIf(
    (env: EnvironmentVariables) => env.NODE_ENV === Environment.Production,
  )
  @IsString()
  @IsNotEmpty({ message: 'TELEGRAM_WEBHOOK_SECRET обязателен в production' })
  TELEGRAM_WEBHOOK_SECRET?: string;

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

  @IsOptional()
  @IsString()
  CLICK_MERCHANT_ID?: string;

  @IsOptional()
  @IsString()
  CLICK_SERVICE_ID?: string;

  @ValidateIf((env: EnvironmentVariables) => hasText(env.CLICK_SERVICE_ID))
  @IsString()
  @IsNotEmpty({
    message: 'CLICK_SECRET_KEY обязателен вместе с CLICK_SERVICE_ID',
  })
  CLICK_SECRET_KEY?: string;

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

  @Transform(optionalInt)
  @IsOptional()
  @IsInt()
  @Min(1000)
  CLICK_REVERSAL_TIMEOUT_MS?: number;

  @IsOptional()
  @IsString()
  PAYME_MERCHANT_ID?: string;

  @ValidateIf((env: EnvironmentVariables) => hasText(env.PAYME_MERCHANT_ID))
  @IsString()
  @IsNotEmpty({
    message: 'PAYME_KEY обязателен вместе с PAYME_MERCHANT_ID',
  })
  PAYME_KEY?: string;

  @IsOptional()
  @IsString()
  PAYME_CHECKOUT_URL?: string;

  @IsOptional()
  @IsString()
  PAYME_ACCOUNT_FIELD?: string;

  @Transform(optionalInt)
  @IsOptional()
  @IsInt()
  @Min(1)
  PAYME_SANDBOX_ORDER_TTL_MIN?: number;

  @IsOptional()
  @IsString()
  PAYME_FISCAL_IKPU?: string;

  @IsOptional()
  @IsString()
  PAYME_FISCAL_PACKAGE_CODE?: string;

  @Transform(optionalInt)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  PAYME_FISCAL_VAT_PERCENT?: number;

  @Transform(optionalInt)
  @IsOptional()
  @IsInt()
  @Min(0)
  PAYME_FISCAL_RECEIPT_TYPE?: number;

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

  @Transform(optionalInt)
  @IsOptional()
  @IsInt()
  @Min(1)
  SUBSCRIPTION_TEST_PRICE_UZS?: number;
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
