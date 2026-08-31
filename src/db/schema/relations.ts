import { relations } from 'drizzle-orm';
import { users } from './users.schema';
import { shops } from './shops.schema';
import { productCards } from './product-cards.schema';
import { productViews } from './product-views.schema';
import { favorites } from './favorites.schema';
import { reports } from './reports.schema';
import { reviews } from './reviews.schema';
import { aiProductChecks } from './ai-products-checks.schema';
import { banners } from './banners.schema';
import { subscriptionPayments } from './subscription-payments.schema';

export const usersRelations = relations(users, ({ many }) => ({
  shops: many(shops),
  productViews: many(productViews),
  favorites: many(favorites),
  reviews: many(reviews),
}));

export const shopsRelations = relations(shops, ({ one, many }) => ({
  owner: one(users, {
    fields: [shops.owner],
    references: [users.id],
  }),
  productCards: many(productCards),
  reports: many(reports),
  reviews: many(reviews),
  subscriptionPayments: many(subscriptionPayments),
  banners: many(banners),
}));

export const subscriptionPaymentsRelations = relations(
  subscriptionPayments,
  ({ one }) => ({
    shop: one(shops, {
      fields: [subscriptionPayments.shopId],
      references: [shops.id],
    }),
    initiator: one(users, {
      fields: [subscriptionPayments.initiatorId],
      references: [users.id],
    }),
  }),
);

export const bannersRelations = relations(banners, ({ one }) => ({
  shop: one(shops, {
    fields: [banners.shopId],
    references: [shops.id],
  }),
  moderator: one(users, {
    fields: [banners.moderatedBy],
    references: [users.id],
  }),
}));

export const productCardsRelations = relations(
  productCards,
  ({ one, many }) => ({
    shop: one(shops, {
      fields: [productCards.shopId],
      references: [shops.id],
    }),
    reports: many(reports),
    reviews: many(reviews),
    aiChecks: many(aiProductChecks),
    views: many(productViews),
  }),
);

export const reviewsRelations = relations(reviews, ({ one }) => ({
  author: one(users, {
    fields: [reviews.authorId],
    references: [users.id],
  }),
  shop: one(shops, {
    fields: [reviews.shopId],
    references: [shops.id],
  }),
  productCard: one(productCards, {
    fields: [reviews.productCardId],
    references: [productCards.id],
  }),
}));

export const favoritesRelations = relations(favorites, ({ one }) => ({
  user: one(users, {
    fields: [favorites.userId],
    references: [users.id],
  }),
  productCard: one(productCards, {
    fields: [favorites.productCardId],
    references: [productCards.id],
  }),
}));

export const productViewsRelations = relations(productViews, ({ one }) => ({
  user: one(users, {
    fields: [productViews.userId],
    references: [users.id],
  }),
  productCard: one(productCards, {
    fields: [productViews.productCardId],
    references: [productCards.id],
  }),
}));

export const reportsRelations = relations(reports, ({ one }) => ({
  author: one(users, {
    fields: [reports.authorId],
    references: [users.id],
  }),
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
