/**
 * Public SHOP API callback routes accepted from CLICK.
 *
 * The application API is versioned under `api/v1`, while the two established
 * integrations use unversioned `/api/...` callback addresses. Both families
 * deliberately resolve to the same controller so an address copied from
 * either working project cannot turn into a provider-side 404.
 */
export const CLICK_CALLBACK_ACTIONS = ['callback', 'prepare', 'complete'];

/** Routes that keep the application's normal `api/v1` global prefix. */
export const CLICK_VERSIONED_CONTROLLER_ROUTES = [
  'subscriptions/click',
  'click',
];

/** Exact controller paths used by the working reference integrations. */
export const CLICK_UNVERSIONED_CONTROLLER_ROUTES = [
  'api/subscriptions/click',
  'api/click',
];

export const CLICK_CONTROLLER_ROUTES = [
  ...CLICK_VERSIONED_CONTROLLER_ROUTES,
  ...CLICK_UNVERSIONED_CONTROLLER_ROUTES,
];

/**
 * Exact routes excluded from the global prefix in `main.ts`.
 *
 * They are expanded instead of using a wildcard because Nest 11's route
 * matcher treats wildcard syntax differently across HTTP adapters. Six
 * literals are cheap and make the production contract explicit.
 */
export const CLICK_UNVERSIONED_CALLBACK_ROUTES =
  CLICK_UNVERSIONED_CONTROLLER_ROUTES.flatMap((controllerPath) =>
    CLICK_CALLBACK_ACTIONS.map((action) => `${controllerPath}/${action}`),
  );
