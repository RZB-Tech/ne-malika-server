-- В некоторых production-базах миграция 0033 была отмечена как применённая,
-- но корень services отсутствует. Создаём оба уровня идемпотентно.
INSERT INTO "categories" (
  "parent_id",
  "slug",
  "name_ru",
  "name_uz_latn",
  "name_uz_cyrl",
  "icon",
  "position"
)
VALUES (
  NULL,
  'services',
  'Услуги',
  'Xizmatlar',
  'Хизматлар',
  'Tools',
  290
)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

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
