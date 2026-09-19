-- Indexes for optimizing product card listing, sorting by newest, and filtering by category/shop
CREATE INDEX IF NOT EXISTS "product_cards_created_at_idx" ON "product_cards" ("created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_cards_active_created_at_idx" ON "product_cards" ("created_at" DESC) WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_cards_shop_active_created_idx" ON "product_cards" ("shop_id", "created_at" DESC) WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_cards_category_active_created_idx" ON "product_cards" ("category_id", "created_at" DESC) WHERE "status" = 'active';
