/**
 * Адреса для кассы Payme. Как и у Click, поддерживаем и версионированный
 * путь (/api/v1/payme), и «голый» (/api/payme): адрес кассы задаётся один раз
 * при её создании, и менять его потом дороже, чем принять оба варианта.
 */
const PAYME_VERSIONED_CONTROLLER_ROUTES = ['subscriptions/payme', 'payme'];

const PAYME_UNVERSIONED_CONTROLLER_ROUTES = [
  'api/subscriptions/payme',
  'api/payme',
];

export const PAYME_CONTROLLER_ROUTES = [
  ...PAYME_VERSIONED_CONTROLLER_ROUTES,
  ...PAYME_UNVERSIONED_CONTROLLER_ROUTES,
];

export const PAYME_UNVERSIONED_CALLBACK_ROUTES =
  PAYME_UNVERSIONED_CONTROLLER_ROUTES;
