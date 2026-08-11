-- Подписки браузера на push-уведомления.
--
-- Подписка принадлежит пользователю, а не браузеру: рассылка выбирает
-- адресатов по роли, и без владельца подписку некуда отнести. У одного
-- человека их несколько — рабочий ноутбук, телефон, второй браузер.
--
-- endpoint уникален глобально: его выдаёт push-сервис браузера, и повторная
-- подписка того же браузера должна обновлять запись, а не плодить дубли.
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" varchar(255) NOT NULL,
	"auth" varchar(255) NOT NULL,
	"user_agent" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_idx" ON "push_subscriptions" USING btree ("endpoint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_id_idx" ON "push_subscriptions" USING btree ("user_id");
--> statement-breakpoint
-- Итог рассылки по второму каналу считается отдельно: у браузера и Telegram
-- разные адресаты, и складывать их в одну цифру значило бы врать обеим.
ALTER TABLE "broadcasts" ADD COLUMN "push_delivered" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "push_failed" integer DEFAULT 0 NOT NULL;
