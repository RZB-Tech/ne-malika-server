CREATE TYPE "public"."chat_message_kind" AS ENUM('buyer', 'seller', 'ai');--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chat_id" bigint NOT NULL,
	"sender_id" bigint,
	"kind" "chat_message_kind" NOT NULL,
	"text" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" bigint NOT NULL,
	"buyer_id" bigint NOT NULL,
	"product_card_id" bigint,
	"product_name" varchar(200),
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_text" varchar(200),
	"buyer_unread" integer DEFAULT 0 NOT NULL,
	"seller_unread" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_product_card_id_product_cards_id_fk" FOREIGN KEY ("product_card_id") REFERENCES "public"."product_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_chat_idx" ON "chat_messages" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chats_buyer_product_idx" ON "chats" USING btree ("buyer_id","product_card_id") WHERE "chats"."product_card_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "chats_buyer_shop_idx" ON "chats" USING btree ("buyer_id","shop_id") WHERE "chats"."product_name" IS NULL;--> statement-breakpoint
CREATE INDEX "chats_shop_idx" ON "chats" USING btree ("shop_id","last_message_at");--> statement-breakpoint
CREATE INDEX "chats_buyer_idx" ON "chats" USING btree ("buyer_id","last_message_at");