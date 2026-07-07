DROP INDEX "shops_owner_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "shops_owner_unique_idx" ON "shops" USING btree ("owner");