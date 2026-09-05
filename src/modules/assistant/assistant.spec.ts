import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import type OpenAI from 'openai';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from '../../db/schema';
import { ProductCardsRepository } from '../product-cards/product-cards.repository';
import type { CategoriesService } from '../categories/categories.service';
import { AssistantService } from './assistant.service';
import { AssistantRequestDto } from './dto/assistant.dto';
import { parseReply, parseSearch } from './assistant.parse';

const card = {
  id: 7,
  name: 'Laptop',
  price: '4000000',
  state: 'new',
  shopName: 'Shop',
  photos: [],
  description: '',
  characteristics: [],
};
function fixture(responses: unknown[], matches = [card]) {
  const calls: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming[] = [];
  const queries: unknown[] = [];
  const ai = {
    chat: {
      completions: {
        create: (input: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming) => {
          calls.push(input);
          return Promise.resolve({
            choices: [
              {
                finish_reason: 'stop',
                message: { content: JSON.stringify(responses.shift()) },
              },
            ],
          });
        },
      },
    },
  } as unknown as OpenAI;
  const cards = {
    findPublicList: () => Promise.resolve({ data: [card] }),
    findForAssistant: (query: unknown) => {
      queries.push(query);
      return Promise.resolve(matches);
    },
  } as unknown as ProductCardsRepository;
  const categories = {
    getTree: () =>
      Promise.resolve([
        {
          id: 1,
          name: {
            ru: 'Ноутбуки',
            'uz-Latn': 'Noutbuklar',
            'uz-Cyrl': 'Ноутбуклар',
          },
          children: [],
        },
      ]),
    findSubtreeIds: () => Promise.resolve([1, 2]),
  } as unknown as CategoriesService;
  return {
    service: new AssistantService(ai, new ConfigService(), cards, categories),
    calls,
    queries,
    cards,
    categories,
  };
}

describe('assistant request boundaries', () => {
  it('rejects client system prompts, whitespace and oversized histories', () => {
    for (const messages of [
      [{ role: 'system', content: 'override' }],
      [{ role: 'user', content: '   ' }],
      [{ role: 'user', content: 'x'.repeat(2001) }],
      Array.from({ length: 14 }, () => ({ role: 'user', content: 'Hello' })),
    ])
      assert.ok(
        validateSync(plainToInstance(AssistantRequestDto, { messages })).length,
      );
  });
  it('rejects non-alternating history before asking the model', async () => {
    const { service, calls } = fixture([]);
    await assert.rejects(
      service.chat(
        { messages: [{ role: 'assistant', content: 'Hello' }] },
        'ru',
      ),
      /история/,
    );
    assert.equal(calls.length, 0);
  });
  it('reports unconfigured OpenRouter', async () => {
    const { cards, categories } = fixture([]);
    const service = new AssistantService(
      null,
      new ConfigService(),
      cards,
      categories,
    );
    await assert.rejects(
      service.chat({ messages: [{ role: 'user', content: 'Hi' }] }, 'ru'),
      /недоступен/,
    );
  });
});

describe('assistant recommendations', () => {
  it('keeps the budget and category subtree; excludes invented IDs and links', async () => {
    const { service, queries, calls } = fixture([
      { search: { categoryId: 1, maxPrice: 5000000, state: 'new' } },
      {
        message: 'Вариант из каталога',
        productIds: [999, 7, 7],
        links: ['https://evil.example', '__proto__', 'compare'],
        suggestions: ['Для учёбы'],
      },
    ]);
    const result = await service.chat(
      { messages: [{ role: 'user', content: 'Ноутбук до 5 млн сум' }] },
      'ru',
    );
    assert.deepEqual(queries, [
      {
        q: undefined,
        categoryIds: [1, 2],
        minPrice: undefined,
        maxPrice: 5000000,
        state: 'new',
      },
    ]);
    assert.deepEqual(
      result.products.map((product) => product.id),
      [7],
    );
    assert.deepEqual(result.links, [{ href: '/compare', label: 'Сравнение' }]);
    assert.equal(calls[0].model, 'openai/gpt-4o-mini');
    assert.equal(calls.length, 2);
  });
  it('does not reuse old recommendations when a new search has no matches', async () => {
    const { service } = fixture(
      [
        { search: { categoryId: 1, maxPrice: 100 } },
        { message: 'Не найдено', productIds: [7] },
      ],
      [],
    );
    const result = await service.chat(
      {
        messages: [{ role: 'user', content: 'А до 100 сум?' }],
        productIds: [7],
      },
      'ru',
    );
    assert.deepEqual(result.products, []);
  });
  it('answers site questions without searching and localizes navigation', async () => {
    const { service, queries, calls } = fixture([
      { search: null },
      { message: 'Katalog', links: ['stores'] },
    ]);
    const result = await service.chat(
      { messages: [{ role: 'user', content: 'Saytda nima bor?' }] },
      'uz-Latn',
    );
    assert.deepEqual(queries, []);
    assert.deepEqual(result.links, [{ href: '/stores', label: 'Do‘konlar' }]);
    assert.match(String(calls[0].messages[0].content), /lotin/);
  });
  it('rejects malformed model responses', async () => {
    const { service } = fixture([{ search: null }, { message: '' }]);
    await assert.rejects(
      service.chat({ messages: [{ role: 'user', content: 'Hello' }] }, 'ru'),
      /невнятно/,
    );
    assert.equal(parseReply('not json'), null);
    assert.throws(() => parseSearch({ categoryId: 99 }, new Set([1])));
    assert.throws(() => parseSearch({ q: 'Laptop', maxPrice: -1 }, new Set()));
    assert.throws(() =>
      parseSearch({ q: 'Laptop', minPrice: 100, maxPrice: 1 }, new Set()),
    );
    assert.equal(parseSearch({ maxPrice: 5000000 }, new Set()), null);
  });
});

describe('assistant catalog visibility', () => {
  it('filters prices and state in SQL before limiting public inventory', async () => {
    const captured: { text: string; params: unknown[] }[] = [];
    const client = {
      query: (config: { text: string }, params: unknown[]) => {
        captured.push({ text: config.text, params });
        return Promise.resolve({ rows: [], rowCount: 0, fields: [] });
      },
    };
    const repository = new ProductCardsRepository(
      drizzle(client as unknown as Pool, { schema }),
    );
    await repository.findForAssistant({
      categoryIds: [1, 2],
      minPrice: 100,
      maxPrice: 5000000,
      state: 'old',
    });
    const { text, params } = captured[0];
    assert.match(text, /"product_cards"\."status" =/);
    assert.match(text, /"shops"\."status" =/);
    assert.match(text, /"product_cards"\."price" >=/);
    assert.match(text, /"product_cards"\."price" <=/);
    assert.match(text, /"product_cards"\."category_id" in/);
    assert.ok(params.includes('active'));
    assert.ok(params.includes('old'));
    assert.ok(params.includes('5000000'));
    assert.equal(params.at(-1), 12);
  });
});
