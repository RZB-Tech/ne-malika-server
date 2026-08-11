-- Поиск по каталогу: выражение в индексе вместо предвычисленного столбца.
--
-- В `search_vector` на проде лежали лексемы только латиницей. У товара
-- «Струйное МФУ Canon PIXMA G4470» находились «Canon» и «PIXMA», а «МФУ» и
-- «Струйное» — нет, хотя стоят в том же названии. Столбец считался один раз и
-- с данными разъехался. Теперь то же выражение живёт в индексе: его Postgres
-- пересчитывает сам при каждой записи, и разъехаться ему уже не с чем.
DROP INDEX IF EXISTS "product_cards_search_vector_idx";
--> statement-breakpoint
ALTER TABLE "product_cards" DROP COLUMN IF EXISTS "search_vector";
--> statement-breakpoint
-- Два словаря на один текст. `russian` приводит слово к основе, поэтому
-- «ноутбуков» находит «ноутбук»; `simple` хранит слово как есть — на нём
-- держатся узбекские и английские названия, которых русский словарь не знает.
CREATE INDEX IF NOT EXISTS "product_cards_search_idx" ON "product_cards" USING gin ((
  to_tsvector('russian', coalesce("name", '') || ' ' || coalesce("description", '')) ||
  to_tsvector('simple', coalesce("name", '') || ' ' || coalesce("description", ''))
));
--> statement-breakpoint
-- Подстрока в названии — ради хвоста артикула: «4470» полнотекстовым поиском
-- не найти, это не начало слова «G4470». Без триграммного индекса такой LIKE
-- читал бы таблицу целиком на каждую букву живого поиска.
CREATE INDEX IF NOT EXISTS "product_cards_name_trgm_idx" ON "product_cards" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shops_name_trgm_idx" ON "shops" USING gin ("name" gin_trgm_ops);
