CREATE TABLE "ai_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint,
	"shop_id" bigint,
	"operation" varchar(20) NOT NULL,
	"model" varchar(120),
	"images" integer DEFAULT 0 NOT NULL,
	"usd" double precision,
	"credits" bigint DEFAULT 0 NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_created_at_idx" ON "ai_usage" USING btree ("created_at" DESC);--> statement-breakpoint
CREATE INDEX "ai_usage_shop_id_idx" ON "ai_usage" USING btree ("shop_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "ai_usage_user_id_idx" ON "ai_usage" USING btree ("user_id","created_at" DESC);