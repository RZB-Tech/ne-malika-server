ALTER TABLE "shops" ADD COLUMN "address" varchar(500);--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "work_schedule" jsonb;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "location" double precision[];--> statement-breakpoint
ALTER TABLE "product_cards" ADD COLUMN "characteristics" jsonb;