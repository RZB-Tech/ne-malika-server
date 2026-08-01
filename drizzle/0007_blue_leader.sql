CREATE TABLE "product_views" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"product_card_id" bigint NOT NULL,
	"view_count" integer DEFAULT 1 NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_views" ADD CONSTRAINT "product_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_views" ADD CONSTRAINT "product_views_product_card_id_product_cards_id_fk" FOREIGN KEY ("product_card_id") REFERENCES "public"."product_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_views_user_card_key" ON "product_views" USING btree ("user_id","product_card_id");--> statement-breakpoint
CREATE INDEX "product_views_user_viewed_at_idx" ON "product_views" USING btree ("user_id","viewed_at" DESC NULLS LAST);