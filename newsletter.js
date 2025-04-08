const axios = require("axios");
const twilio = require("twilio");
require("dotenv").config();

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const login = process.env.PEPTIDES_LOGIN;
const password = process.env.PEPTIDES_PASSWORD;

const sendMessage = async (phone, firstName, middleName, balance) => {
  const fullName = `${firstName} ${middleName}`.trim();

  const body = `🎉 ${fullName}, на вашем бонусном счете ${balance} тг. Вы можете использовать их для покупки продукции Peptides.`;

  try {
    const message = await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER,
      to: `+${phone}`,
      body: body,
    });

    console.log(`✅ Сообщение отправлено на ${phone}: ${message.sid}`);
  } catch (err) {
    console.error(`❌ Ошибка при отправке на ${phone}:`, err.message);
  }
};

const run = async () => {
  try {
    // Авторизация
    const authResponse = await axios.post("https://lk.peptides1.ru/api/auth/sign-in", {
      login,
      password,
    });

    const token = authResponse.data.token;

    // Получение партнёров
    const partnersResponse = await axios.get(
      "https://lk.peptides1.ru/api/dealers/231253/partners?with_side_volume=true&limit=100&offset=0",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const users = partnersResponse.data.items;

    // Поиск нужного номера
    const user = users.find((u) => u.phone === "77057633896");

    if (!user) {
      console.log("❌ Пользователь с таким номером не найден");
      return;
    }

    console.log(`✅ Найден пользователь: ${user.first_name} ${user.middle_name}`);
    console.log(`💰 Бонусный баланс: ${user.account_balance} тг`);

    await sendMessage(user.phone, user.first_name, user.middle_name, user.account_balance);
  } catch (err) {
    console.error("❌ Ошибка выполнения:", err.message);
  }
};

run();
