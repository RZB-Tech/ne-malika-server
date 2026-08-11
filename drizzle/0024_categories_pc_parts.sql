-- «Запчасти для ПК» отдельным разделом каталога.
--
-- Раздел pc-parts нужен тем, кто торгует комплектующими б/у и на разбор:
-- покупатель ищет «запчасти для ПК» одним пунктом меню, а не обходит девять
-- корней (видеокарты, процессоры, платы, память...). Существующие корни при
-- этом остаются на месте: в них уже лежат товары, а перенести их под нового
-- родителя нельзя — клиент рисует ровно два уровня дерева и третий не покажет.
-- Поэтому у листьев здесь свои slug'и с префиксом pc-, а не копии корневых:
-- так в БД сразу видно, что это раздел запчастей, а не дубль каталога.
--
-- Корпуса отдельным листом не добавляем: корень cases — это они и есть, ему
-- достаточно вернуть в название слово «кейсы», по которому их ищут.

INSERT INTO "categories" ("parent_id", "slug", "name_ru", "name_uz_latn", "name_uz_cyrl", "icon", "position") VALUES
  (NULL, 'pc-parts', 'Запчасти для ПК', 'PK uchun ehtiyot qismlar', 'ПК учун эҳтиёт қисмлар', 'Microchip', 25)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO "categories" ("parent_id", "slug", "name_ru", "name_uz_latn", "name_uz_cyrl", "position")
SELECT parent.id, child.slug, child.ru, child.latn, child.cyrl, child.pos
FROM (VALUES
  ('pc-parts', 'pc-gpu',         'Видеокарты',              'Videokartalar',            'Видеокарталар',              10),
  ('pc-parts', 'pc-motherboard', 'Материнские платы',       'Ona platalar',             'Она платалар',               20),
  ('pc-parts', 'pc-cpu',         'Процессоры',              'Protsessorlar',            'Процессорлар',               30),
  ('pc-parts', 'pc-ram',         'Оперативная память',      'Operativ xotira',          'Оператив хотира',            40),
  ('pc-parts', 'pc-storage',     'Накопители (SSD и HDD)',  'Disklar (SSD va HDD)',     'Дисклар (SSD ва HDD)',       50),
  ('pc-parts', 'pc-psu',         'Блоки питания',           'Quvvat bloklari',          'Қувват блоклари',            60),
  ('pc-parts', 'pc-cooling',     'Охлаждение и кулеры',     'Sovutish va kulerlar',     'Совутиш ва кулерлар',        70),
  ('pc-parts', 'pc-cables',      'Кабели и разъёмы питания','Kabel va quvvat ulagichlari','Кабель ва қувват улагичлари',80),
  ('pc-parts', 'pc-other',       'Прочие комплектующие',    'Boshqa butlovchi qismlar', 'Бошқа бутловчи қисмлар',    90)
) AS child(parent_slug, slug, ru, latn, cyrl, pos)
JOIN "categories" parent ON parent."slug" = child.parent_slug AND parent."parent_id" IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Названия, по которым эти разделы искали и не находили: «HDD» латиницей не
-- ищут по-русски, а «Корпуса» без слова «кейсы» не узнают.
UPDATE "categories"
SET "name_ru" = 'Жёсткие диски (HDD)',
    "name_uz_latn" = 'Qattiq disklar (HDD)',
    "name_uz_cyrl" = 'Қаттиқ дисклар (HDD)'
WHERE "slug" = 'hdd' AND "parent_id" IS NULL;
--> statement-breakpoint

UPDATE "categories"
SET "name_ru" = 'Корпуса ПК (кейсы)',
    "name_uz_latn" = 'PK korpuslari (keyslar)',
    "name_uz_cyrl" = 'ПК корпуслари (кейслар)'
WHERE "slug" = 'cases' AND "parent_id" IS NULL;
