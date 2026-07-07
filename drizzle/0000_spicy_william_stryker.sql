CREATE TYPE "public"."ai_verdict" AS ENUM('pass', 'warn', 'fail');--> statement-breakpoint
CREATE TYPE "public"."analytics_event_type" AS ENUM('product_view', 'shop_view', 'telegram_click', 'phone_click', 'search_prompt');--> statement-breakpoint
CREATE TYPE "public"."entity_status" AS ENUM('active', 'abolished');--> statement-breakpoint
CREATE TYPE "public"."product_state" AS ENUM('new', 'old');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('seller', 'admin');--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"telegram_username" varchar(64),
	"telegram_id" bigint NOT NULL,
	"telegram_chat_id" bigint,
	"telegram_photo" varchar(1024),
	"phone_number" varchar(20),
	"fullname" varchar(200) NOT NULL,
	"role" "user_role" DEFAULT 'seller' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner" bigint NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"photo" uuid,
	"telegram_link" varchar(255) NOT NULL,
	"contact" varchar(20) NOT NULL,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"abolish_reason" text,
	"abolished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_cards" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"photos" uuid[] DEFAULT '{}' NOT NULL,
	"price" numeric(14, 2) NOT NULL,
	"state" "product_state" NOT NULL,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"abolish_reason" text,
	"abolished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"context" text NOT NULL,
	"shop_id" bigint NOT NULL,
	"product_card_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" "analytics_event_type" NOT NULL,
	"product_card_id" bigint,
	"shop_id" bigint,
	"session_id" varchar(128) NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_product_checks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_card_id" bigint NOT NULL,
	"verdict" "ai_verdict" NOT NULL,
	"checks" jsonb NOT NULL,
	"summary" text,
	"model" varchar(100) NOT NULL,
	"tokens_used" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_owner_users_id_fk" FOREIGN KEY ("owner") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_cards" ADD CONSTRAINT "product_cards_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_product_card_id_product_cards_id_fk" FOREIGN KEY ("product_card_id") REFERENCES "public"."product_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_product_card_id_product_cards_id_fk" FOREIGN KEY ("product_card_id") REFERENCES "public"."product_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_product_checks" ADD CONSTRAINT "ai_product_checks_product_card_id_product_cards_id_fk" FOREIGN KEY ("product_card_id") REFERENCES "public"."product_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_telegram_id_idx" ON "users" USING btree ("telegram_id");--> statement-breakpoint
CREATE INDEX "shops_owner_idx" ON "shops" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "shops_status_idx" ON "shops" USING btree ("status");--> statement-breakpoint
CREATE INDEX "product_cards_shop_id_idx" ON "product_cards" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "product_cards_status_idx" ON "product_cards" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reports_shop_id_idx" ON "reports" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "analytics_events_type_created_at_idx" ON "analytics_events" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_shop_id_idx" ON "analytics_events" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "analytics_events_product_card_id_idx" ON "analytics_events" USING btree ("product_card_id");--> statement-breakpoint
CREATE INDEX "analytics_events_session_id_idx" ON "analytics_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "ai_product_checks_product_card_id_idx" ON "ai_product_checks" USING btree ("product_card_id");