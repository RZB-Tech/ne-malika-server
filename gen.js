const crypto = require('crypto');

// 1. Данные вашего бота и юзера
const BOT_TOKEN = '8891051823:AAHkYeNIWDeaWJA8A0mHdnEtsALqdybSeUY';
const user = {
  id: 123456789, // ваш Telegram ID
  first_name: 'Alexey',
  username: 'alexey_username',
  language_code: 'ru',
};

const authDate = Math.floor(Date.now() / 1000).toString();

// 2. Формируем пары ключ=значение (без hash)
const dataPairs = [
  `auth_date=${authDate}`,
  `user=${JSON.stringify(user)}`,
].sort(); // Telegram требует сортировки по алфавиту

const dataCheckString = dataPairs.join('\n');

// 3. Считаем правильный hash на основе токена бота
const secretKey = crypto
  .createHmac('sha256', 'WebAppData')
  .update(BOT_TOKEN)
  .digest();
const hash = crypto
  .createHmac('sha256', secretKey)
  .update(dataCheckString)
  .digest('hex');

// 4. Получаем готовую строку для Swagger
const initData = `${dataPairs.join('&')}&hash=${hash}`;
console.log('Ваша initData для Swagger:\n\n', initData);
