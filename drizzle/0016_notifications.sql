CREATE TYPE "public"."broadcast_audience" AS ENUM('all', 'sellers', 'buyers');
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_notifications_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_nudge_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "broadcasts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"author_id" bigint,
	"audience" "broadcast_audience" NOT NULL,
	"text" text NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcasts_created_at_idx" ON "broadcasts" USING btree ("created_at" DESC);
--> statement-breakpoint
-- Рассылки и уведомления выбирают только тех, кому бот вправе писать: чат
-- заводится лишь после /start, до него sendMessage вернёт 403.
CREATE INDEX IF NOT EXISTS "users_telegram_chat_id_idx" ON "users" USING btree ("telegram_chat_id") WHERE "telegram_chat_id" IS NOT NULL;
