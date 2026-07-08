ALTER TABLE "product_cards"
ADD COLUMN IF NOT EXISTS "search_vector" tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('russian', coalesce("name", '')), 'A') ||
  setweight(to_tsvector('russian', coalesce("description", '')), 'B')
) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_cards_search_vector_idx"
ON "product_cards" USING gin ("search_vector");
