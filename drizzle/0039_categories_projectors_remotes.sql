-- Проекторы и пульты дистанционного управления.
--
-- Проекторы — отдельным корнем, а не листом «Мониторов»: проектор ищут словом
-- «проектор», и прятать его внутрь мониторов значит требовать от покупателя
-- догадки. Позиция 35 ставит раздел между «Мониторами» (30) и «Видеокартами»
-- (40) — рядом с тем, чем на него смотрят.
--
-- Экраны в названии не случайно: полотно продают вместе с проектором и ищут
-- там же, а «Матрицы и экраны» в «Запчастях» — про ноутбучные матрицы. Дробить
-- раздел на проекторы/экраны/крепления не станем — как «Сумки и рюкзаки»
-- (0029): выбор здесь делают глазами по витрине, а не в меню каталога.
INSERT INTO "categories" ("parent_id", "slug", "name_ru", "name_uz_latn", "name_uz_cyrl", "icon", "position") VALUES
  (NULL, 'projectors', 'Проекторы и экраны', 'Proyektorlar va ekranlar', 'Проекторлар ва экранлар', 'Projector', 35)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Пульты — листом в «Периферию», а не новым корнем: корней в меню каталога уже
-- под три десятка, и каждый следующий разбавляет список — то же соображение,
-- что и в миграции 0015. Пульт при этом такое же устройство ввода, как
-- клавиатура и мышь, и покупатель ищет его там же.
--
-- Позиция 50 — сразу за «Ковриками» (40), последним листом раздела.
INSERT INTO "categories" ("parent_id", "slug", "name_ru", "name_uz_latn", "name_uz_cyrl", "position")
SELECT parent."id", child.slug, child.ru, child.latn, child.cyrl, child.pos
FROM (VALUES
  ('peripherals', 'remotes', 'Пульты дистанционного управления', 'Masofadan boshqarish pultlari', 'Масофадан бошқариш пултлари', 50)
) AS child(parent_slug, slug, ru, latn, cyrl, pos)
JOIN "categories" parent ON parent."slug" = child.parent_slug AND parent."parent_id" IS NULL
ON CONFLICT DO NOTHING;
