CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"author_id" bigint NOT NULL,
	"shop_id" bigint NOT NULL,
	"product_card_id" bigint,
	"rating" integer NOT NULL,
	"text" text,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"moderation_note" text,
	"moderated_by" bigint,
	"moderated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating_range" CHECK ("reviews"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "rating_avg" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "rating_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_cards" ADD COLUMN "rating_avg" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_cards" ADD COLUMN "rating_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_card_id_product_cards_id_fk" FOREIGN KEY ("product_card_id") REFERENCES "public"."product_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_author_product_idx" ON "reviews" USING btree ("author_id","product_card_id") WHERE "reviews"."product_card_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_author_shop_idx" ON "reviews" USING btree ("author_id","shop_id") WHERE "reviews"."product_card_id" IS NULL;--> statement-breakpoint
CREATE INDEX "reviews_product_idx" ON "reviews" USING btree ("product_card_id","status");--> statement-breakpoint
CREATE INDEX "reviews_shop_idx" ON "reviews" USING btree ("shop_id","status");--> statement-breakpoint
CREATE INDEX "reviews_status_idx" ON "reviews" USING btree ("status","created_at");