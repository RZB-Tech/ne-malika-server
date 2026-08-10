CREATE TABLE "categories" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"parent_id" bigint,
	"slug" varchar(80) NOT NULL,
	"name_ru" varchar(120) NOT NULL,
	"name_uz_latn" varchar(120) NOT NULL,
	"name_uz_cyrl" varchar(120) NOT NULL,
	"icon" varchar(40),
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_cards" ADD COLUMN "category_id" bigint;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_parent_id_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_parent_slug_idx" ON "categories" USING btree ("parent_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_root_slug_idx" ON "categories" USING btree ("slug") WHERE "categories"."parent_id" IS NULL;--> statement-breakpoint
ALTER TABLE "product_cards" ADD CONSTRAINT "product_cards_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_cards_category_id_idx" ON "product_cards" USING btree ("category_id");