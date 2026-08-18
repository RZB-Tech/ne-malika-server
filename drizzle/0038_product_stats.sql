-- Статистика карточки товара по суткам: просмотры, уникальные посетители,
-- раскрытия телефона и переходы в Telegram.
--
-- Агрегат, а не журнал событий: строка на пару «товар + день», счётчики растут
-- через ON CONFLICT DO UPDATE. Журнал каждого захода анонима рос бы неограниченно
-- и всё равно потребовал бы свёртки для графика — она делается сразу, на записи.
-- Ценой этого теряется детализация внутри суток (час, реферер, устройство).
--
-- Заменяет Яндекс.Метрику в кабинете продавца: раньше эти цифры читались из её
-- API тремя запросами на каждое открытие карточки, с задержкой до часа и под
-- квотой. Здесь они появляются сразу и стоят один SELECT.
--
-- Не путать с product_views: та таблица — личная история покупателя «что я
-- смотрел», одна строка на пару «пользователь + товар» с перезаписью времени.
-- Временного ряда из неё не собрать, и анонимов там нет вовсе.
CREATE TABLE "product_stats_daily" (
	"product_card_id" bigint NOT NULL,
	"day" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"visitors" integer DEFAULT 0 NOT NULL,
	"phone_clicks" integer DEFAULT 0 NOT NULL,
	"telegram_clicks" integer DEFAULT 0 NOT NULL,
	"contact_visitors" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_stats_daily_product_card_id_day_pk" PRIMARY KEY("product_card_id","day")
);
--> statement-breakpoint
ALTER TABLE "product_stats_daily" ADD CONSTRAINT "product_stats_daily_product_card_id_product_cards_id_fk" FOREIGN KEY ("product_card_id") REFERENCES "public"."product_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_stats_daily_day_idx" ON "product_stats_daily" USING btree ("day");