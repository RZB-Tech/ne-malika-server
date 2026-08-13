-- Приветственные кредиты тем, кто зарегистрировался до запуска акции.
--
-- Новым магазинам их начисляет ShopsService при создании; здесь — разовая
-- догонялка по уже существующим. Число должно совпадать с WELCOME_CREDITS
-- в src/modules/credits/credits.constants.ts.
--
-- Баланс и журнал меняются одним запросом: CTE обновляет магазины и отдаёт
-- новый остаток, а INSERT пишет его же в balance_after. Двумя отдельными
-- запросами история разъехалась бы с балансом, если второй не дойдёт.
--
-- NOT EXISTS делает миграцию безопасной при повторном прогоне и при накатке
-- на базу, где акция уже проходила: магазин с меткой promo=welcome
-- пропускается, второй раз подарок не выдаётся.
WITH granted AS (
	UPDATE "shops"
	SET "credits_balance" = "credits_balance" + 150
	WHERE NOT EXISTS (
		SELECT 1
		FROM "credit_transactions" t
		WHERE t."shop_id" = "shops"."id"
		  AND t."meta"->>'promo' = 'welcome'
	)
	RETURNING "id", "credits_balance"
)
INSERT INTO "credit_transactions" ("shop_id", "author_id", "kind", "amount", "balance_after", "note", "meta")
SELECT
	"id",
	NULL,
	'grant',
	150,
	"credits_balance",
	'Приветственные кредиты на пробную генерацию',
	'{"promo":"welcome"}'::jsonb
FROM granted;
