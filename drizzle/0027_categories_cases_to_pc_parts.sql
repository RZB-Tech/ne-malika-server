-- Корпуса (кейсы) переезжают в «Запчасти для ПК» и теряют дробную разбивку.
--
-- Кейс покупают целиком и выбирают глазами, а не по типоразмеру: шесть
-- подкатегорий (Mid-Tower, Full-Tower, Mini-ITX, с подсветкой, тихие, со
-- стеклом) заставляли выбирать раньше, чем человек увидел хоть один товар.
-- Заодно раздел встаёт туда, где его ищут, — рядом с остальными комплектующими.
--
-- Порядок инструкций существенный, переставлять нельзя:
--   1) товары из удаляемых листьев поднимаются в сам раздел ДО удаления:
--      product_cards.category_id → ON DELETE SET NULL, и без этого шага каждый
--      корпус остался бы вообще без категории;
--   2) сам раздел переносится последним — предыдущий шаг ищет его среди корней.

UPDATE "product_cards" pc
SET "category_id" = parent."id"
FROM "categories" child
JOIN "categories" parent ON parent."id" = child."parent_id"
WHERE pc."category_id" = child."id"
  AND parent."parent_id" IS NULL
  AND parent."slug" = 'cases';
--> statement-breakpoint

DELETE FROM "categories"
WHERE "parent_id" = (
  SELECT "id" FROM "categories"
  WHERE "parent_id" IS NULL AND "slug" = 'cases'
);
--> statement-breakpoint

-- icon снимаем: его рисуют только у корней, у листа он не используется.
-- Позиция 95 — сразу после «Прочих комплектующих» (90).
UPDATE "categories"
SET "parent_id" = (
      SELECT "id" FROM "categories"
      WHERE "slug" = 'pc-parts' AND "parent_id" IS NULL
    ),
    "icon" = NULL,
    "position" = 95
WHERE "slug" = 'cases' AND "parent_id" IS NULL;
