-- Кредиты магазина на ИИ-генерацию.
--
-- Баланс у магазина, а не у пользователя: платит магазин, и при смене
-- владельца остаток должен остаться на месте.
--
-- Единица — кредит, 1000 кредитов = $1 фактического расхода у OpenRouter.
-- Целое число, а не деньги с плавающей точкой: доли цента при тысячах
-- операций накапливают ошибку, а сравнение «хватает ли» должно быть точным.
CREATE TYPE "public"."credit_txn_kind" AS ENUM('grant', 'spend', 'refund', 'adjust');
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "credits_balance" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Занято под запросы, которые сейчас выполняются: между проверкой остатка и
-- списанием проходит время генерации.
ALTER TABLE "shops" ADD COLUMN "credits_reserved" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"author_id" bigint,
	"kind" "credit_txn_kind" NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"note" varchar(200),
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_transactions_shop_id_idx" ON "credit_transactions" USING btree ("shop_id","created_at" DESC);
--> statement-breakpoint
-- Прежняя квота по числу картинок заменена деньгами: два ограничителя в двух
-- местах давали два разных отказа об одном и том же.
ALTER TABLE "users" DROP COLUMN IF EXISTS "image_gen_enabled";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "image_gen_limit";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "image_gen_reserved";
