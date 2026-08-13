-- Раздел «Услуги».
--
-- На площадке торгуют не только железом: ремонт, чистка, установка систем и
-- восстановление данных давно продаются здесь же, но складывались в чужие
-- разделы или оставались вовсе без категории — найти их можно было только
-- поиском. Отдельный корень в конце списка (290, сразу за «Запчастями»),
-- потому что услугу ищут как услугу, а не среди комплектующих.
--
-- Разделом он открыт для всех магазинов: ограничение по разрешению нужно было
-- для мобильной техники, а чинить технику вправе любой продавец.
INSERT INTO "categories" ("parent_id", "slug", "name_ru", "name_uz_latn", "name_uz_cyrl", "icon", "position") VALUES
  (NULL, 'services', 'Услуги', 'Xizmatlar', 'Хизматлар', 'Tools', 290)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Подразделы по роду работ, а не по технике: человек приходит с «не включается
-- ноутбук», а не с «услуга категории А». Slug'и с суффиксами (software-install,
-- network-setup) — чтобы не путались с одноимёнными корнями каталога.
INSERT INTO "categories" ("parent_id", "slug", "name_ru", "name_uz_latn", "name_uz_cyrl", "position")
SELECT parent.id, child.slug, child.ru, child.latn, child.cyrl, child.pos
FROM (VALUES
  ('services', 'repair-laptop',    'Ремонт ноутбуков',            'Noutbuk ta’miri',            'Ноутбук таъмири',             10),
  ('services', 'repair-pc',        'Ремонт компьютеров',          'Kompyuter ta’miri',          'Компьютер таъмири',           20),
  ('services', 'repair-mobile',    'Ремонт телефонов и планшетов','Telefon va planshet ta’miri','Телефон ва планшет таъмири',  30),
  ('services', 'repair-print',     'Ремонт и заправка принтеров', 'Printer ta’miri va to’ldirish','Принтер таъмири ва тўлдириш',40),
  ('services', 'cleaning',         'Чистка и обслуживание',       'Tozalash va profilaktika',   'Тозалаш ва профилактика',     50),
  ('services', 'software-install', 'Установка программ и ОС',     'Dastur va OT o’rnatish',     'Дастур ва ОТ ўрнатиш',        60),
  ('services', 'data-recovery',    'Восстановление данных',       'Ma’lumotlarni tiklash',      'Маълумотларни тиклаш',        70),
  ('services', 'pc-assembly',      'Сборка и апгрейд ПК',         'PK yig’ish va apgreyd',      'ПК йиғиш ва апгрейд',         80),
  ('services', 'diagnostics',      'Диагностика',                 'Diagnostika',                'Диагностика',                 90),
  ('services', 'network-setup',    'Настройка сети и интернета',  'Tarmoq va internet sozlash', 'Тармоқ ва интернет созлаш',  100)
) AS child(parent_slug, slug, ru, latn, cyrl, pos)
JOIN "categories" parent ON parent."slug" = child.parent_slug AND parent."parent_id" IS NULL
ON CONFLICT DO NOTHING;
