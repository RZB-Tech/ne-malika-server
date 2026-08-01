-- Тип пересоздаётся, а не расширяется через ALTER TYPE ... ADD VALUE:
-- добавленное таким образом значение нельзя использовать в той же транзакции,
-- а drizzle прогоняет все миграции одной — SET DEFAULT 'user' упал бы с
-- "unsafe use of new value of enum type".
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."user_role" RENAME TO "user_role_old";--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'seller', 'admin');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."user_role" USING "role"::text::"public"."user_role";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'user';--> statement-breakpoint
DROP TYPE "public"."user_role_old";--> statement-breakpoint
-- Раньше продавцом становился каждый, кто вошёл через Telegram. Приводим
-- накопленные аккаунты к новому правилу: продавец без магазина — покупатель.
-- Администраторов не трогаем.
UPDATE "users" SET "role" = 'user'
WHERE "role" = 'seller'
  AND NOT EXISTS (
    SELECT 1 FROM "shops" WHERE "shops"."owner" = "users"."id"
  );
