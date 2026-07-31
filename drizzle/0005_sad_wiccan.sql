ALTER TABLE "users" ADD COLUMN "blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "block_reason" text;