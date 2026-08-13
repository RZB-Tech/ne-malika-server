-- Доначисление приветственных кредитов: со 150 до 300.
--
-- Прежний подарок в 150 кредитов не покрывал даже один запрос на дефолтных
-- настройках формы (две картинки 960×1280 medium стоят 197), поэтому размер
-- подарка подняли до 300. Здесь — разница для тех, кто успел получить старые
-- 150; новым магазинам ShopsService сразу выдаёт полную сумму.
--
-- Условие отбора точное, а не «всем подряд»:
--   * есть выдача promo=welcome ровно на 150 — это старый подарок;
--   * ещё нет выдачи promo=welcome_topup — разницу не давали.
-- Поэтому магазины, получившие сразу 300, не тронуты, а повторный прогон
-- миграции ничего не меняет.
--
-- Баланс и журнал обновляются одним запросом: CTE отдаёт новый остаток, и он
-- же уходит в balance_after — иначе история разъедется с балансом.
WITH granted AS (
	UPDATE "shops"
	SET "credits_balance" = "credits_balance" + 150
	WHERE EXISTS (
		SELECT 1
		FROM "credit_transactions" t
		WHERE t."shop_id" = "shops"."id"
		  AND t."meta"->>'promo' = 'welcome'
		  AND t."amount" = 150
	)
	AND NOT EXISTS (
		SELECT 1
		FROM "credit_transactions" t
		WHERE t."shop_id" = "shops"."id"
		  AND t."meta"->>'promo' = 'welcome_topup'
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
	'Приветственные кредиты: доначисление до 300',
	'{"promo":"welcome_topup"}'::jsonb
FROM granted;
