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
    // Отправляем приветствие с шаблоном
    await client.messages.create({
      from: waNumber,
      to: from,
      contentSid: process.env.TEMPLATE_SID,
    });
    sessions[from] = { step: "waiting_for_command" };
    return res.status(200).send();
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

    // 🔥 Обработка кнопки "Каталог препаратов" — отправка PDF
    if (message === "Каталог препаратов") {
      console.log("Нажата кнопка 'Каталог препаратов'. Отправка PDF...");
      try {
        await client.messages.create({
          from: waNumber,
          to: from,
          body: "📘 Вот наш актуальный каталог препаратов в PDF формате:",
          mediaUrl: ['https://drive.google.com/uc?export=download&id=1PlfNYjfZStMz02kXTbdsr8HnaRBusvV5'], // <-- замени на свою прямую ссылку
        });
        console.log("Каталог PDF успешно отправлен.");
      } catch (err) {
        console.error("Ошибка при отправке PDF каталога:", err.message);
        await client.messages.create({
          from: waNumber,
          to: from,
          body: "❌ Не удалось отправить каталог. Попробуйте позже.",
        });
      }
    }
  }

  // Логика для других шагов, например, ожидаем логин
  else if (session.step === "waiting_for_login") {
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
      // Авторизация и получение токена
      const authResponse = await axios.post(
        "https://lk.peptides1.ru/api/auth/sign-in",
        {
          login: session.login,
          password: session.password,
        }
      );

      const token = authResponse.data.token;

      // Получение информации о бонусах
      const bonusResponse = await axios.get(
        "https://lk.peptides1.ru/api/partners/current/closing-info",
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const bonusAmount = bonusResponse.data.current.balance[0].amount;

      await client.messages.create({
        from: waNumber,
        to: from,
        body: `🎉 Ваш бонусный баланс: ${bonusAmount} тг`,
      });
    } catch (err) {
      console.error("Ошибка при получении баланса:", err.message);
      await client.messages.create({
        from: waNumber,
        to: from,
        body: "❌ Ошибка при получении данных. Пожалуйста, проверьте логин и пароль.",
      });
    }

    delete sessions[from];
    return res.status(200).send();
  }

  return res.status(200).send();
});

app.get("/", (req, res) => {
  res.send("✅ WhatsApp бот работает");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
