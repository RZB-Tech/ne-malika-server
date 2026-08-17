-- Пульты дистанционного управления.
--
-- Листом в «Периферию», а не новым корнем: корней в меню каталога уже под три
-- десятка, и каждый следующий разбавляет список — то же соображение, что и в
-- миграции 0015. Пульт при этом такое же устройство ввода, как клавиатура и
-- мышь, и покупатель ищет его там же.
--
-- Позиция 50 — сразу за «Ковриками» (40), последним листом раздела.
INSERT INTO "categories" ("parent_id", "slug", "name_ru", "name_uz_latn", "name_uz_cyrl", "position")
SELECT parent."id", child.slug, child.ru, child.latn, child.cyrl, child.pos
FROM (VALUES
  ('peripherals', 'remotes', 'Пульты дистанционного управления', 'Masofadan boshqarish pultlari', 'Масофадан бошқариш пултлари', 50)
) AS child(parent_slug, slug, ru, latn, cyrl, pos)
JOIN "categories" parent ON parent."slug" = child.parent_slug AND parent."parent_id" IS NULL
ON CONFLICT DO NOTHING;
