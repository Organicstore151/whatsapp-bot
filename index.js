const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const axios = require("axios");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Хранилище сессий пользователей
const sessions = {};

app.post("/webhook", async (req, res) => {
  const from = req.body.From;
  const message = req.body.Body.trim();
  const waNumber = req.body.To;

  if (!sessions[from]) {
    // Отправляем приветствие и кнопки
    await client.messages.create({
      from: waNumber,
      to: from,
      contentSid: process.env.TEMPLATE_SID,
    });
    sessions[from] = { step: "waiting_for_command" };
    return res.sendStatus(200); // Ответ только после первого сообщения
  }

  const session = sessions[from];

  if (session.step === "waiting_for_command") {
    if (message === "Узнать баланс бонусов") {
      await client.messages.create({
        from: waNumber,
        to: from,
        body: "Пожалуйста, отправьте ваш ID (логин):",
      });
      session.step = "waiting_for_login";
    }
  } else if (session.step === "waiting_for_login") {
    session.login = message;
    session.step = "waiting_for_password";
    await client.messages.create({
      from: waNumber,
      to: from,
      body: "Теперь введите пароль:",
    });
  } else if (session.step === "waiting_for_password") {
    session.password = message;
    session.step = "done";

    try {
      // Получение токена
      const authResponse = await axios.post(
        "https://old-lk.peptides1.ru/api/v1/auth/login",
        {
          login: session.login,
          password: session.password,
        }
      );

      const token = authResponse.data.token;

      // Получение данных пользователя
      const userResponse = await axios.get(
        "https://old-lk.peptides1.ru/api/v1/dealer/account",
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const bonus = userResponse.data.account_balance;

      await client.messages.create({
        from: waNumber,
        to: from,
        body: `🎉 Ваш бонусный баланс: ${bonus} ₽`,
      });
    } catch (err) {
      console.error("Ошибка при получении баланса:", err.message);
      await client.messages.create({
        from: waNumber,
        to: from,
        body: "❌ Ошибка при получении данных. Пожалуйста, проверьте логин и пароль.",
      });
    }

    // Сбросим сессию
    delete sessions[from];
  }

  // Ответим только один раз при первом запросе
  res.sendStatus(200); 
});

app.get("/", (req, res) => {
  res.send("✅ WhatsApp бот работает");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
