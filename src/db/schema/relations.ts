import { relations } from 'drizzle-orm';
import { users } from './users.schema';
import { shops } from './shops.schema';
import { productCards } from './product-cards.schema';
import { reports } from './reports.schema';
import { aiProductChecks } from './ai-products-checks.schema';

export const usersRelations = relations(users, ({ many }) => ({
  shops: many(shops),
}));

export const shopsRelations = relations(shops, ({ one, many }) => ({
  owner: one(users, {
    fields: [shops.owner],
    references: [users.id],
  }),
  productCards: many(productCards),
  reports: many(reports),
}));

export const productCardsRelations = relations(
  productCards,
  ({ one, many }) => ({
    shop: one(shops, {
      fields: [productCards.shopId],
      references: [shops.id],
    }),
    reports: many(reports),
    aiChecks: many(aiProductChecks),
  }),
);

export const reportsRelations = relations(reports, ({ one }) => ({
  shop: one(shops, {
    fields: [reports.shopId],
    references: [shops.id],
  }),
  productCard: one(productCards, {
    fields: [reports.productCardId],
    references: [productCards.id],
  }),
}));

export const aiProductChecksRelations = relations(
  aiProductChecks,
  ({ one }) => ({
    productCard: one(productCards, {
      fields: [aiProductChecks.productCardId],
      references: [productCards.id],
    }),
  }),
);
