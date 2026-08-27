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
 *   Той же причиной оставлены по-русски отказы админских ручек подписки
 *   («Магазин упразднён — подписку выдавать нечему», «У магазина нет
 *   действующей подписки», «Магазин с оплаченной подпиской удалить нельзя —
 *   сначала отмените подписку»): язык интерфейса администратора один;
 * — коды ответа колбэка Click (`CLICK_RESPONSE`): их читает робот провайдера,
 *   сверка идёт по строке, и перевод сломал бы приём оплаты. Служебное
 *   «Платёжный документ уже учтён другим платежом» до пользователя тоже не
 *   доходит — исключение ловит `ClickController` и отвечает кодом протокола.
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
  'Товар упразднён администратором — изменить его нельзя': {
    'uz-Latn':
      'Mahsulot administrator tomonidan tugatilgan — uni o‘zgartirib bo‘lmaydi',
    'uz-Cyrl':
      'Маҳсулот администратор томонидан тугатилган — уни ўзгартириб бўлмайди',
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
  'ИИ-сравнение сейчас недоступно': {
    'uz-Latn': 'Sun’iy intellekt bilan taqqoslash hozir ishlamayapti',
    'uz-Cyrl': 'Сунъий интеллект билан таққослаш ҳозир ишламаяпти',
  },
  'Нужно хотя бы два доступных товара: часть выбранного уже не продаётся': {
    'uz-Latn':
      'Kamida ikkita mavjud mahsulot kerak: tanlanganlarning bir qismi endi sotuvda yo‘q',
    'uz-Cyrl':
      'Камида иккита мавжуд маҳсулот керак: танланганларнинг бир қисми энди сотувда йўқ',
  },
  'Модель не ответила — попробуйте позже': {
    'uz-Latn': 'Model javob bermadi — keyinroq urinib ko‘ring',
    'uz-Cyrl': 'Модел жавоб бермади — кейинроқ уриниб кўринг',
  },
  'Модель ответила невнятно — попробуйте ещё раз': {
    'uz-Latn': 'Model tushunarsiz javob qaytardi — yana urinib ko‘ring',
    'uz-Cyrl': 'Модел тушунарсиз жавоб қайтарди — яна уриниб кўринг',
  },
  'start должен быть в формате HH:mm': {
    'uz-Latn': 'start HH:mm formatida bo‘lishi kerak',
    'uz-Cyrl': 'start HH:mm форматида бўлиши керак',
  },
  'end должен быть в формате HH:mm': {
    'uz-Latn': 'end HH:mm formatida bo‘lishi kerak',
    'uz-Cyrl': 'end HH:mm форматида бўлиши керак',
  },

  /* Подписка магазина */
  'Подписка доступна только владельцу активного магазина': {
    'uz-Latn': 'Obuna faqat faol do‘kon egasi uchun mavjud',
    'uz-Cyrl': 'Обуна фақат фаол дўкон эгаси учун мавжуд',
  },
  'Оплата подписки временно недоступна': {
    'uz-Latn': 'Obunani to‘lash vaqtincha ishlamayapti',
    'uz-Cyrl': 'Обунани тўлаш вақтинча ишламаяпти',
  },
  'Неизвестный тариф': {
    'uz-Latn': 'Noma’lum tarif',
    'uz-Cyrl': 'Номаълум тариф',
  },

  /* Кредиты на ИИ */
  'Кредиты закончились. Обратитесь к администратору за пополнением.': {
    'uz-Latn':
      'Kreditlar tugadi. To‘ldirish uchun administratorga murojaat qiling.',
    'uz-Cyrl':
      'Кредитлар тугади. Тўлдириш учун администраторга мурожаат қилинг.',
  },
  'Генерация доступна только владельцу активного магазина.': {
    'uz-Latn': 'Generatsiya faqat faol do‘kon egasi uchun mavjud.',
    'uz-Cyrl': 'Генерация фақат фаол дўкон эгаси учун мавжуд.',
  },

  /* Баннер магазина */
  'Баннер доступен на тарифе MAX': {
    'uz-Latn': 'Banner MAX tarifida mavjud',
    'uz-Cyrl': 'Баннер MAX тарифида мавжуд',
  },
  'Баннер уже загружен — отредактируйте существующий': {
    'uz-Latn': 'Banner allaqachon yuklangan — mavjudini tahrirlang',
    'uz-Cyrl': 'Баннер аллақачон юкланган — мавжудини таҳрирланг',
  },
  'Баннер не найден': {
    'uz-Latn': 'Banner topilmadi',
    'uz-Cyrl': 'Баннер топилмади',
  },
  'Укажите причину отказа': {
    'uz-Latn': 'Rad etish sababini ko‘rsating',
    'uz-Cyrl': 'Рад этиш сабабини кўрсатинг',
  },
  'Изображение не загружено — повторите загрузку файла': {
    'uz-Latn': 'Rasm yuklanmagan — faylni qaytadan yuklang',
    'uz-Cyrl': 'Расм юкланмаган — файлни қайтадан юкланг',
  },
  'Не удалось проверить файл в S3': {
    'uz-Latn': 'Faylni S3 da tekshirib bo‘lmadi',
    'uz-Cyrl': 'Файлни S3 да текшириб бўлмади',
  },

  /* Аналитика магазина */
  'Период больше 30 дней доступен на тарифе MAX': {
    'uz-Latn': '30 kundan uzoq davr MAX tarifida mavjud',
    'uz-Cyrl': '30 кундан узоқ давр MAX тарифида мавжуд',
  },
  'Статистика поисковых запросов доступна на тарифе MAX': {
    'uz-Latn': 'Qidiruv so‘rovlari statistikasi MAX tarifida mavjud',
    'uz-Cyrl': 'Қидирув сўровлари статистикаси MAX тарифида мавжуд',
  },
  'Выгрузка CSV доступна на тарифе MAX': {
    'uz-Latn': 'CSV yuklab olish MAX tarifida mavjud',
    'uz-Cyrl': 'CSV юклаб олиш MAX тарифида мавжуд',
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

  const match = NESTED_PREFIX.exec(message);
  if (!match) return message;

  const rest = message.slice(match[1].length);
  const translated = TRANSLATIONS[rest]?.[locale];
  return translated ? `${match[1]}${translated}` : message;
}
