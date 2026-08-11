-- Доступ к генерации карточек и расход квоты.
--
-- Лимит считается по строкам generated_images, а не отдельным счётчиком:
-- счётчик и история неизбежно разъезжаются, а здесь «использовано» — это
-- ровно то, что человек может увидеть своими глазами в галерее.
ALTER TABLE "users" ADD COLUMN "image_gen_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- NULL — безлимитно. Ноль означает именно «доступ выдан, но квота исчерпана».
ALTER TABLE "users" ADD COLUMN "image_gen_limit" integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "generated_images" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint,
	"source_key" uuid NOT NULL,
	"key" uuid NOT NULL,
	"prompt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generated_images" ADD CONSTRAINT "generated_images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Галерея открывается по исходному фото: «что уже нарисовано для этой карточки».
CREATE INDEX IF NOT EXISTS "generated_images_source_key_idx" ON "generated_images" USING btree ("source_key","created_at" DESC);
--> statement-breakpoint
-- Расход квоты — счёт строк одного пользователя.
CREATE INDEX IF NOT EXISTS "generated_images_user_id_idx" ON "generated_images" USING btree ("user_id");
