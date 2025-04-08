const axios = require('axios');
const twilio = require('twilio');
require('dotenv').config();

// Twilio клиент
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Токен для авторизации
const token = '2f0cdbd3-cff8-46bb-bfbe-80b50e88ef6e';  // замените на свой токен

// Номер для теста
const testPhone = "77057633896";  // телефон для отправки

// Функция для отправки сообщения пользователю
async function sendMessage(phone, firstName, middleName, bonusAmount) {
  try {
    const message = `🎉 Уважаемый ${firstName} ${middleName}, ваш бонусный баланс составляет ${bonusAmount} тг. Используйте его для покупок!`;

    const response = await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER, // Замените на ваш номер WhatsApp из Twilio
      to: `whatsapp:+7${phone}`,
      body: message,
    });

    // Логируем SID сообщения для отслеживания
    console.log(`Сообщение отправлено на номер ${phone}. SID: ${response.sid}`);

  } catch (err) {
    console.error(`Ошибка при отправке сообщения на номер ${phone}:`, err.message);
  }
}

// Функция для получения данных о пользователе
async function fetchUserData() {
  try {
    const response = await axios.get('https://lk.peptides1.ru/api/dealers/231253/partners?with_side_volume=true&limit=100&offset=0', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const users = response.data.data;

    // Находим пользователя с нужным номером
    const user = users.find(u => u.phone === testPhone);

    if (!user) {
      console.log('Пользователь с таким номером не найден');
      return;
    }

    console.log(`Найден пользователь: ${user.first_name} ${user.middle_name}, баланс: ${user.account_balance}`);

    // Отправляем сообщение с балансом
    await sendMessage(user.phone, user.first_name, user.middle_name, user.account_balance);

  } catch (err) {
    console.error('Ошибка при получении данных пользователя:', err.message);
  }
}

// Запуск теста
fetchUserData();
