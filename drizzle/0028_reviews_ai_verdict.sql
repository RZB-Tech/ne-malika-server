ALTER TABLE "reviews" ADD COLUMN "ai_verdict" "ai_verdict";--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "ai_note" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "ai_checked_at" timestamp with time zone;