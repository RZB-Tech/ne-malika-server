import { registerDecorator, type ValidationOptions } from 'class-validator';

/**
 * Адрес push-сервиса приходит от клиента и попадает прямо в web-push, который
 * ходит по нему запросом с сервера. Без проверки любой вошедший пользователь
 * подписывался бы на `http://127.0.0.1:6379/` или `http://169.254.169.254/…`
 * и превращал рассылку в SSRF по внутренней сети контейнера.
 *
 * Поэтому адрес обязан быть https и вести на хост известного push-провайдера.
 * Новый браузер со своим сервисом — добавить его сюда: список закрытый
 * намеренно, «разрешить всё кроме приватных сетей» обходится DNS-записью,
 * указывающей на 127.0.0.1.
 */
const ALLOWED_HOST_SUFFIXES = [
  // Chrome, Edge, Opera, Samsung Internet — все через FCM
  'fcm.googleapis.com',
  'android.googleapis.com',
  // Firefox
  'push.services.mozilla.com',
  'mozaws.net',
  // Windows Notification Service (старый Edge)
  'notify.windows.com',
  'push.services.microsoft.com',
  // Safari
  'push.apple.com',
];

const MAX_ENDPOINT_LENGTH = 2000;

function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

export function isAllowedPushEndpoint(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > MAX_ENDPOINT_LENGTH) return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;
  // Логин с паролем в адресе — способ запутать разбор хоста, провайдерам не нужен.
  if (url.username || url.password) return false;
  // Свой порт push-сервисам тоже не нужен, а вот дотянуться до соседнего
  // сервиса на том же хосте он бы позволил.
  if (url.port) return false;

  return hostAllowed(url.hostname);
}

export function IsPushEndpoint(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isPushEndpoint',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => isAllowedPushEndpoint(value),
        defaultMessage: () =>
          'endpoint должен быть https-адресом известного push-сервиса браузера',
      },
    });
  };
}
