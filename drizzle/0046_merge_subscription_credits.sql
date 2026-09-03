-- Объединяем кредиты подписки с общим балансом кредитов магазинов
UPDATE "shops"
SET "credits_balance" = "credits_balance" + "subscription_credits",
    "subscription_credits" = 0
WHERE "subscription_credits" > 0;
