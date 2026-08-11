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
 * Сообщения, которых тут нет, локализовать нечем: текст ИИ-проверки пишет
 * модель на языке, который был неизвестен в момент проверки, а ошибки
 * генерации картинок и настроек видит только администратор.
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
  'start должен быть в формате HH:mm': {
    'uz-Latn': 'start HH:mm formatida bo‘lishi kerak',
    'uz-Cyrl': 'start HH:mm форматида бўлиши керак',
  },
  'end должен быть в формате HH:mm': {
    'uz-Latn': 'end HH:mm formatida bo‘lishi kerak',
    'uz-Cyrl': 'end HH:mm форматида бўлиши керак',
  },
};

/** Перевод текста ошибки. Незнакомую строку отдаём как есть. */
export function translateMessage(message: string, locale: ApiLocale): string {
  if (locale === 'ru') return message;
  return TRANSLATIONS[message]?.[locale] ?? message;
}
