import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
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

  /** Без него ИИ-проверка товаров не запускается. */
  @IsOptional()
  @IsString()
  GROQ_API_KEY?: string;

  @IsOptional()
  @IsString()
  GROQ_MODEL?: string;

  @IsOptional()
  @IsString()
  GROQ_BASE_URL?: string;

  @IsString()
  JWT_ACCESS_SECRET: string;

  @IsString()
  JWT_ACCESS_TTL: string;

  @IsString()
  JWT_REFRESH_SECRET: string;

  @IsString()
  JWT_REFRESH_TTL: string;

  @IsOptional()
  @IsString()
  TELEGRAM_BOT_TOKEN?: string;

  @IsInt()
  TELEGRAM_INIT_DATA_TTL_SEC: number;

  @IsOptional()
  @IsString()
  TELEGRAM_WEBHOOK_URL?: string;

  @IsOptional()
  @IsString()
  TELEGRAM_WEBHOOK_SECRET?: string;

  @IsOptional()
  @IsString()
  S3_ENDPOINT?: string;

  @IsString()
  S3_REGION: string;

  @IsString()
  S3_BUCKET: string;

  @IsOptional()
  @IsString()
  S3_ACCESS_KEY?: string;

  @IsOptional()
  @IsString()
  S3_SECRET_KEY?: string;

  @IsOptional()
  @IsString()
  S3_PUBLIC_BASE?: string;
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
