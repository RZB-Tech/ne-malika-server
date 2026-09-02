/**
 * Формы запроса и ответа отдельного Images API у OpenRouter.
 *
 * SDK OpenAI про этот эндпоинт не знает — его дёргают через `client.post`,
 * поэтому типы описаны здесь. Живут рядом с `usageCost`, который читает
 * `usage.cost` из этого же ответа.
 */

/** Образец для правки: Images API принимает и ссылку, и data-URL. */
export interface ImageReference {
  type: 'image_url';
  image_url: { url: string };
}

/**
 * Картинки приходят байтами в base64, а не ссылками. `usage.cost` —
 * фактическая стоимость в долларах, по ней и списываются кредиты.
 */
export interface OpenRouterImagesResponse {
  data?: { b64_json?: string; media_type?: string }[];
  usage?: { cost?: number };
}
