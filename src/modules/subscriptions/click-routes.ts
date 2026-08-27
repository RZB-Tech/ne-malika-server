export const CLICK_CALLBACK_ACTIONS = ['callback', 'prepare', 'complete'];

const CLICK_VERSIONED_CONTROLLER_ROUTES = ['subscriptions/click', 'click'];

const CLICK_UNVERSIONED_CONTROLLER_ROUTES = [
  'api/subscriptions/click',
  'api/click',
];

export const CLICK_CONTROLLER_ROUTES = [
  ...CLICK_VERSIONED_CONTROLLER_ROUTES,
  ...CLICK_UNVERSIONED_CONTROLLER_ROUTES,
];

export const CLICK_UNVERSIONED_CALLBACK_ROUTES =
  CLICK_UNVERSIONED_CONTROLLER_ROUTES.flatMap((controllerPath) =>
    CLICK_CALLBACK_ACTIONS.map((action) => `${controllerPath}/${action}`),
  );
