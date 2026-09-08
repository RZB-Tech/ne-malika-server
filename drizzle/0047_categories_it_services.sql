-- Отдельный раздел для IT-услуг внутри общего раздела услуг.
-- Корень services уже помечает дочерние категории как услуги для ИИ-проверки.
INSERT INTO "categories" (
  "parent_id",
  "slug",
  "name_ru",
  "name_uz_latn",
  "name_uz_cyrl",
  "position"
)
SELECT parent.id, 'it-services', 'IT-услуги', 'IT xizmatlari', 'IT хизматлари', 110
FROM "categories" parent
WHERE parent."slug" = 'services' AND parent."parent_id" IS NULL
ON CONFLICT DO NOTHING;
