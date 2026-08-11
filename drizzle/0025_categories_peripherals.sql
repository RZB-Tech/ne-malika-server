-- Раздел «Периферия»: клавиатуры, мышки, наушники и коврики одним пунктом.
--
-- Было четыре разных места: три корня со своей дробной разбивкой и коврики
-- внутри мышек. «Клавиатуры» при этом сразу предлагали выбрать между
-- механическими, мембранными и беспроводными — лишний уровень решений, ведь
-- покупатель ищет клавиатуру, а не тип переключателей. Разбивку убираем, сами
-- разделы становятся листьями «Периферии».
--
-- Порядок инструкций здесь существенный, и переставлять их нельзя:
--   1) коврики уходят из mice раньше всего — иначе следующие два шага примут
--      их за такую же дробную подкатегорию и снесут вместе с «Офисными»;
--   2) товары из удаляемых листьев поднимаются в раздел-родитель ДО удаления:
--      product_cards.category_id → ON DELETE SET NULL, и без этого шага каждая
--      карточка в «Механических» осталась бы без категории;
--   3) сами разделы переносятся в «Периферию» последними — предыдущие шаги
--      ищут их среди корней.

INSERT INTO "categories" ("parent_id", "slug", "name_ru", "name_uz_latn", "name_uz_cyrl", "icon", "position") VALUES
  (NULL, 'peripherals', 'Периферия', 'Periferiya', 'Периферия', 'Keyboard', 130)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Коврики переносим UPDATE'ом, а не парой INSERT+DELETE: id категории
-- сохраняется, и товары продавцов остаются привязанными.
UPDATE "categories"
SET "parent_id" = (
      SELECT "id" FROM "categories"
      WHERE "slug" = 'peripherals' AND "parent_id" IS NULL
    ),
    "name_ru" = 'Коврики',
    "position" = 40
WHERE "slug" = 'pads'
  AND "parent_id" = (
    SELECT "id" FROM "categories"
    WHERE "slug" = 'mice' AND "parent_id" IS NULL
  );
--> statement-breakpoint

UPDATE "product_cards" pc
SET "category_id" = parent."id"
FROM "categories" child
JOIN "categories" parent ON parent."id" = child."parent_id"
WHERE pc."category_id" = child."id"
  AND parent."parent_id" IS NULL
  AND parent."slug" IN ('keyboards', 'mice', 'headphones');
--> statement-breakpoint

DELETE FROM "categories"
WHERE "parent_id" IN (
  SELECT "id" FROM "categories"
  WHERE "parent_id" IS NULL
    AND "slug" IN ('keyboards', 'mice', 'headphones')
);
--> statement-breakpoint

-- icon снимаем: его рисуют только у корней, у листа он не используется.
UPDATE "categories" ch
SET "parent_id" = (
      SELECT "id" FROM "categories"
      WHERE "slug" = 'peripherals' AND "parent_id" IS NULL
    ),
    "icon" = NULL,
    "position" = v.pos
FROM (VALUES
  ('keyboards',  10),
  ('mice',       20),
  ('headphones', 30)
) AS v(slug, pos)
WHERE ch."slug" = v.slug AND ch."parent_id" IS NULL;
