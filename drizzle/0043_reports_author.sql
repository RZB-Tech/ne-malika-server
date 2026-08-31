ALTER TABLE "reports" ADD COLUMN "author_id" bigint;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_author_idx" ON "reports" USING btree ("author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_author_product_idx" ON "reports" USING btree ("author_id","product_card_id") WHERE "reports"."product_card_id" IS NOT NULL AND "reports"."author_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_author_shop_idx" ON "reports" USING btree ("author_id","shop_id") WHERE "reports"."product_card_id" IS NULL AND "reports"."author_id" IS NOT NULL;
