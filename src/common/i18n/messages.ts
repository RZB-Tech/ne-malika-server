import { type ApiLocale } from './locale';

/**
 * Переводы текстов ошибок, которые видит пользователь.
 *
 * Ключ — русская строка ровно в том виде, в каком она написана в throw. Так
 * сделано намеренно: иначе пришлось бы завести коды и переписать три десятка
 * мест, а любая опечатка в коде молча выдавала бы пустой текст. Здесь же
 * промах по ключу означает всего лишь «останется по-русски» — то же поведение,
 * что было до перевода.
 *
 * Что осознанно осталось по-русски:
 * — текст ИИ-проверки: его пишет модель на языке, который в момент проверки
 *   ещё неизвестен;
 * — сообщения, собранные из шаблона с подстановкой («Аккаунт заблокирован:
 *   {причина}», «Осталось N из M»): ключом служит готовая строка, а она у
 *   каждого запроса своя. Их перевод потребует кодов вместо текстов;
 * — служебное про OPENROUTER_API_KEY и вебхук: это видит только администратор.
 */
const TRANSLATIONS: Record<string, Record<Exclude<ApiLocale, 'ru'>, string>> = {
  'Отсутствует access-токен': {
    'uz-Latn': 'Access-token yo‘q',
    'uz-Cyrl': 'Access-токен йўқ',
  },
  'Неверный тип токена': {
    'uz-Latn': 'Token turi noto‘g‘ri',
    'uz-Cyrl': 'Токен тури нотўғри',
  },
  'Отсутствует refresh-токен': {
    'uz-Latn': 'Refresh-token yo‘q',
    'uz-Cyrl': 'Refresh-токен йўқ',
  },
  'Недействительный refresh-токен': {
    'uz-Latn': 'Refresh-token yaroqsiz',
    'uz-Cyrl': 'Refresh-токен яроқсиз',
  },
  'Недостаточно прав для этого действия': {
    'uz-Latn': 'Bu amal uchun huquqlar yetarli emas',
    'uz-Cyrl': 'Бу амал учун ҳуқуқлар етарли эмас',
  },
  'Неверный секрет вебхука': {
    'uz-Latn': 'Vebhuk maxfiy kaliti noto‘g‘ri',
    'uz-Cyrl': 'Вебхук махфий калити нотўғри',
  },
  'Пользователь не найден': {
    'uz-Latn': 'Foydalanuvchi topilmadi',
    'uz-Cyrl': 'Фойдаланувчи топилмади',
  },
  'Категория не найдена': {
    'uz-Latn': 'Kategoriya topilmadi',
    'uz-Cyrl': 'Категория топилмади',
  },
  'Товар не найден': {
    'uz-Latn': 'Mahsulot topilmadi',
    'uz-Cyrl': 'Маҳсулот топилмади',
  },
  'Товар не найден или недоступен': {
    'uz-Latn': 'Mahsulot topilmadi yoki mavjud emas',
    'uz-Cyrl': 'Маҳсулот топилмади ёки мавжуд эмас',
  },
  'Такого товара нет в избранном': {
    'uz-Latn': 'Bunday mahsulot sevimlilarda yo‘q',
    'uz-Cyrl': 'Бундай маҳсулот севимлиларда йўқ',
  },
  'Такого товара нет в вашей истории': {
    'uz-Latn': 'Bunday mahsulot tarixingizda yo‘q',
    'uz-Cyrl': 'Бундай маҳсулот тарихингизда йўқ',
  },
  'Магазин не найден': {
    'uz-Latn': 'Do‘kon topilmadi',
    'uz-Cyrl': 'Дўкон топилмади',
  },
  'Магазин не найден или вам не принадлежит': {
    'uz-Latn': 'Do‘kon topilmadi yoki sizga tegishli emas',
    'uz-Cyrl': 'Дўкон топилмади ёки сизга тегишли эмас',
  },
  'У пользователя уже есть магазин': {
    'uz-Latn': 'Foydalanuvchida allaqachon do‘kon bor',
    'uz-Cyrl': 'Фойдаланувчида аллақачон дўкон бор',
  },
  'Файл не найден': {
    'uz-Latn': 'Fayl topilmadi',
    'uz-Cyrl': 'Файл топилмади',
  },
  'Не удалось получить файл из S3': {
    'uz-Latn': 'Faylni S3 dan olib bo‘lmadi',
    'uz-Cyrl': 'Файлни S3 дан олиб бўлмади',
  },
  'Проверка ещё не выполнялась': {
    'uz-Latn': 'Tekshiruv hali o‘tkazilmagan',
    'uz-Cyrl': 'Текширув ҳали ўтказилмаган',
  },
  'Недействительный или просроченный токен': {
    'uz-Latn': 'Token yaroqsiz yoki muddati o‘tgan',
    'uz-Cyrl': 'Токен яроқсиз ёки муддати ўтган',
  },
  'Telegram-авторизация временно недоступна': {
    'uz-Latn': 'Telegram orqali kirish vaqtincha ishlamayapti',
    'uz-Cyrl': 'Телеграм орқали кириш вақтинча ишламаяпти',
  },
  'Аккаунт заблокирован администратором': {
    'uz-Latn': 'Hisob administrator tomonidan bloklangan',
    'uz-Cyrl': 'Ҳисоб администратор томонидан блокланган',
  },
  'Товар не принадлежит указанному магазину': {
    'uz-Latn': 'Mahsulot ko‘rsatilgan do‘konga tegishli emas',
    'uz-Cyrl': 'Маҳсулот кўрсатилган дўконга тегишли эмас',
  },
  'Товар упразднён администратором — отправить на проверку нельзя': {
    'uz-Latn':
      'Mahsulot administrator tomonidan tugatilgan — tekshiruvga yuborib bo‘lmaydi',
    'uz-Cyrl':
      'Маҳсулот администратор томонидан тугатилган — текширувга юбориб бўлмайди',
  },
  'Магазин упразднён — добавлять товары нельзя': {
    'uz-Latn': 'Do‘kon tugatilgan — mahsulot qo‘shib bo‘lmaydi',
    'uz-Cyrl': 'Дўкон тугатилган — маҳсулот қўшиб бўлмайди',
  },
  'Не удалось определить telegram_link по умолчанию — у аккаунта нет username, укажите ссылку явно':
    {
      'uz-Latn':
        'telegram_link ni aniqlab bo‘lmadi — hisobda username yo‘q, havolani qo‘lda kiriting',
      'uz-Cyrl':
        'telegram_link ни аниқлаб бўлмади — ҳисобда username йўқ, ҳаволани қўлда киритинг',
    },
  'Не удалось определить контакт по умолчанию — номер телефона ещё не подтверждён через бота, укажите контакт явно':
    {
      'uz-Latn':
        'Aloqa raqamini aniqlab bo‘lmadi — telefon bot orqali tasdiqlanmagan, raqamni qo‘lda kiriting',
      'uz-Cyrl':
        'Алоқа рақамини аниқлаб бўлмади — телефон бот орқали тасдиқланмаган, рақамни қўлда киритинг',
    },
  'Генерация изображений не подключена. Обратитесь к администратору.': {
    'uz-Latn': 'Rasm generatsiyasi ulanmagan. Administratorga murojaat qiling.',
    'uz-Cyrl': 'Расм генерацияси уланмаган. Администраторга мурожаат қилинг.',
  },
  'start должен быть в формате HH:mm': {
    'uz-Latn': 'start HH:mm formatida bo‘lishi kerak',
    'uz-Cyrl': 'start HH:mm форматида бўлиши керак',
  },
  'end должен быть в формате HH:mm': {
    'uz-Latn': 'end HH:mm formatida bo‘lishi kerak',
    'uz-Cyrl': 'end HH:mm форматида бўлиши керак',
  },
};

/**
 * Префикс пути, который ValidationPipe приписывает к сообщению вложенного DTO:
 * `workSchedule.0.start должен быть...`. Ключ в словаре — только сам текст,
 * поэтому префикс отрезаем перед поиском и возвращаем на место после.
 */
const NESTED_PREFIX =
  /^((?:[A-Za-z_$][\w$]*|\d+)(?:\.(?:[A-Za-z_$][\w$]*|\d+))*\.)(?=\S)/;

/** Перевод текста ошибки. Незнакомую строку отдаём как есть. */
export function translateMessage(message: string, locale: ApiLocale): string {
  if (locale === 'ru') return message;

  const direct = TRANSLATIONS[message]?.[locale];
  if (direct) return direct;

  // Сообщения вложенной валидации приходят с путём: без этого шага строка
  // «workSchedule.0.start должен быть в формате HH:mm» не нашлась бы в словаре
  // и осталась бы по-русски при любом языке интерфейса.
  const match = NESTED_PREFIX.exec(message);
  if (!match) return message;

  const rest = message.slice(match[1].length);
  const translated = TRANSLATIONS[rest]?.[locale];
  return translated ? `${match[1]}${translated}` : message;
}
