import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CLICK_CALLBACK_ACTIONS,
  CLICK_CONTROLLER_ROUTES,
  CLICK_UNVERSIONED_CALLBACK_ROUTES,
} from './click-routes';

describe('публичные маршруты колбэка Click', () => {
  it('принимает callback, prepare и complete одним обработчиком', () => {
    assert.deepEqual(CLICK_CALLBACK_ACTIONS, [
      'callback',
      'prepare',
      'complete',
    ]);
  });

  it('сохраняет versioned-маршруты приложения и добавляет пути рабочих образцов', () => {
    assert.deepEqual(CLICK_CONTROLLER_ROUTES, [
      'subscriptions/click',
      'click',
      'api/subscriptions/click',
      'api/click',
    ]);
  });

  it('исключает из api/v1 ровно шесть unversioned callback-маршрутов', () => {
    assert.deepEqual(CLICK_UNVERSIONED_CALLBACK_ROUTES, [
      'api/subscriptions/click/callback',
      'api/subscriptions/click/prepare',
      'api/subscriptions/click/complete',
      'api/click/callback',
      'api/click/prepare',
      'api/click/complete',
    ]);
  });
});
