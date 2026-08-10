-- Кронштейны, мини-дисплеи и USB-порты.
--
-- Кладём листьями в существующие разделы, а не новыми корнями: корней уже 26,
-- и каждый новый разбавляет меню каталога. «Материнские платы» здесь нет
-- намеренно — такой корень уже существует с миграции 0012.
--
-- Мини-дисплеи — это отдельные экранчики (часы, мониторинг температуры,
-- панели в корпус), а не мониторы и не матрицы для ноутбуков: для последних
-- в parts уже есть «Матрицы и экраны».

INSERT INTO "categories" ("parent_id", "slug", "name_ru", "name_uz_latn", "name_uz_cyrl", "position")
SELECT parent.id, child.slug, child.ru, child.latn, child.cyrl, child.pos
FROM (VALUES
  ('monitors', 'mounts',        'Кронштейны и крепления', 'Kronshteyn va mahkamlagichlar', 'Кронштейн ва маҳкамлагичлар', 110),
  ('monitors', 'mini-displays', 'Мини-дисплеи и модули',  'Mini displey va modullar',      'Мини дисплей ва модуллар',    120),
  ('parts',    'usb-ports',     'USB-порты и планки',     'USB portlar va plankalar',      'USB портлар ва планкалар',    100)
) AS child(parent_slug, slug, ru, latn, cyrl, pos)
JOIN "categories" parent ON parent."slug" = child.parent_slug AND parent."parent_id" IS NULL
ON CONFLICT DO NOTHING;
