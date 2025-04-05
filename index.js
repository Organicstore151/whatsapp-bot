const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const axios = require("axios");
require("dotenv").config();

const app = express(); // Объявляем переменную app для работы с Express
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Хранилище сессий пользователей
const sessions = {};

app.post("/webhook", async (req, res) => {
  const from = req.body.From;
  const message = req.body.Body.trim();
  const waNumber = req.body.To;

  console.log(`Message received from ${from}: ${message}`);

  if (!sessions[from]) {
    // Новая сессия: проверяем, чтобы не отправлять приветственное сообщение, если уже есть активная сессия
    sessions[from] = { step: "waiting_for_command" };

    await client.messages.create({
      from: waNumber,
      to: from,
      contentSid: process.env.TEMPLATE_SID,
    });

    console.log(`New session created for ${from}.`);

    return res.sendStatus(200);
  }

  const session = sessions[from];
  console.log(`Current step for ${from}: ${session.step}`); // Логируем шаг сессии

  switch (session.step) {
    case "waiting_for_command":
      if (message === "Узнать баланс бонусов") {
        session.step = "waiting_for_login";
        await client.messages.create({
          from: waNumber,
          to: from,
          body: "Пожалуйста, введите ваш ID (логин):",
        });
      } else {
        await client.messages.create({
          from: waNumber,
          to: from,
          body: "Выберите одну из кнопок, пожалуйста.",
        });
      }
      break;

    case "waiting_for_login":
      session.login = message;
      session.step = "waiting_for_password";
      await client.messages.create({
        from: waNumber,
        to: from,
        body: "Теперь введите пароль:",
      });
      break;

    case "waiting_for_password":
      session.password = message;
      session.step = "done";

      try {
        // Авторизация
        const authResponse = await axios.post(
          "https://old-lk.peptides1.ru/api/v1/auth/login",
          {
            login: session.login,
            password: session.password,
          }
        );

        const token = authResponse.data.token; // Получение бонусов
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
        console.error("Ошибка:", err.message);
        await client.messages.create({
          from: waNumber,
          to: from,
          body: "❌ Ошибка при входе. Проверьте логин и пароль.",
        });
      }

      // Сброс сессии
      delete sessions[from];
      break;

    default:
      await client.messages.create({
        from: waNumber,
        to: from,
        body: "Давайте начнем сначала. Напишите любое сообщение.",
      });
      delete sessions[from];
  }

  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("✅ WhatsApp бот работает");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
