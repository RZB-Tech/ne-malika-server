CREATE TABLE "favorites" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"product_card_id" bigint NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_product_card_id_product_cards_id_fk" FOREIGN KEY ("product_card_id") REFERENCES "public"."product_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "favorites_user_card_key" ON "favorites" USING btree ("user_id","product_card_id");--> statement-breakpoint
CREATE INDEX "favorites_user_added_at_idx" ON "favorites" USING btree ("user_id","added_at" DESC NULLS LAST);