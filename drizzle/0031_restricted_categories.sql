-- Закрытые разделы каталога: «Смартфоны» и «Планшеты» возвращаются, но
-- выкладывать в них товар может не всякий магазин, а только тот, кому
-- администратор выдал доступ.
--
-- Почему флаг у категории, а не список slug'ов в коде: «закрытость» — свойство
-- справочника, и закрыть завтра ещё один раздел должно быть правкой данных, а
-- не деплоем. Разрешение при этом одно на магазин: админ решает «этому продавцу
-- мобильную технику можно», а не отмечает галочки по разделам.
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "restricted" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "restricted_categories_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- Возвращаем корни, удалённые миграцией 0014. Slug'и те же самые: по ним
-- подбирается иконка на клиенте, и старые ссылки на раздел снова заработают.
--
-- Позиции 235 и 240 ставят разделы после «Сумок и рюкзаков» (230) и перед
-- «Флешками» (250) — там же, где они стояли до удаления.
--
-- Не DO NOTHING, как в остальных сидах каталога: там повтор безвреден, а здесь
-- уже существующий корень остался бы открытым для всех — то есть миграция
-- прошла бы «успешно», не сделав ровно того, ради чего написана.
INSERT INTO "categories" ("parent_id", "slug", "name_ru", "name_uz_latn", "name_uz_cyrl", "icon", "position", "restricted") VALUES
  (NULL, 'tablets', 'Планшеты',  'Planshetlar', 'Планшетлар', 'Tablet',     235, true),
  (NULL, 'phones',  'Смартфоны', 'Smartfonlar', 'Смартфонлар', 'Smartphone', 240, true)
ON CONFLICT ("slug") WHERE "parent_id" IS NULL DO UPDATE SET "restricted" = true;
--> statement-breakpoint

-- Подкатегории — ровно те, что были в 0012 и 0013 до удаления родителей.
--
-- Флаг им не ставим: закрыт раздел целиком, и наследование от корня считает
-- сервер. Иначе добавленная позже подкатегория молча оказалась бы открытой.
INSERT INTO "categories" ("parent_id", "slug", "name_ru", "name_uz_latn", "name_uz_cyrl", "position")
SELECT parent.id, child.slug, child.ru, child.latn, child.cyrl, child.pos
FROM (VALUES
  ('tablets', 'android-tab',    'Android',                 'Android',                'Android',                10),
  ('tablets', 'ipad',           'iPad',                    'iPad',                   'iPad',                   20),
  ('tablets', 'graphic-tab',    'Графические планшеты',    'Grafik planshetlar',     'График планшетлар',      30),
  ('tablets', 'ereaders',       'Электронные книги',       'Elektron kitoblar',      'Электрон китоблар',      40),
  ('tablets', 'tab-accessories','Аксессуары для планшетов','Planshet aksessuarlari', 'Планшет аксессуарлари',  50),
  ('tablets', 'styluses',       'Стилусы',                 'Styluslar',              'Стилуслар',              60),

  ('phones',  'android-phone',  'Android',                 'Android',                'Android',                10),
  ('phones',  'iphone',         'iPhone',                  'iPhone',                 'iPhone',                 20),
  ('phones',  'phone-acc',      'Аксессуары',              'Aksessuarlar',           'Аксессуарлар',           30),
  ('phones',  'smartwatch',     'Смарт-часы',              'Smart soatlar',          'Смарт соатлар',          40),
  ('phones',  'phone-cases',    'Чехлы',                   'G‘iloflar',              'Ғилофлар',               50),
  ('phones',  'powerbanks',     'Внешние аккумуляторы',    'Powerbanklar',           'Пауэрбанклар',           60),
  ('phones',  'phone-glass',    'Защитные стёкла',         'Himoya shishalari',      'Ҳимоя шишалари',         70)
) AS child(parent_slug, slug, ru, latn, cyrl, pos)
JOIN "categories" parent
  ON parent.slug = child.parent_slug AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;
