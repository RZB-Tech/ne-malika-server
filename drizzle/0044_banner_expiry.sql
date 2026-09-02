-- Срок показа баннера: NULL — бессрочно, иначе после этой метки баннер
-- пропадает из карусели, но остаётся в админке с пометкой «истёк».
ALTER TABLE "banners" ADD COLUMN "expires_at" timestamp with time zone;
