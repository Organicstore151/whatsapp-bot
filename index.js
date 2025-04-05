const express = require("express");
const bodyParser = require("body-parser");
const { MessagingResponse } = require("twilio").twiml;
const twilio = require("twilio");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 8080;

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.post("/webhook", async (req, res) => {
  try {
    console.log("📦 Полный req.body:", req.body);

    const from = req.body.From;
    const to = req.body.To;
    const message = req.body.Body;

    if (!from || !to || !message) {
      console.log("❌ Не хватает параметров 'from', 'to' или 'Body'");
      res.set("Content-Type", "application/json");
      return res.status(200).send({});
    }

    console.log(`📩 Сообщение от ${from}: ${message}`);

    const action = message.trim().toLowerCase();
    console.log("🆔 Action:", action);

    switch (action) {
      case "привет":
      case "start":
      case "начать":
        await client.messages.create({
          from: to,
          to: from,
          body: "Здравствуйте! Чем могу помочь?",
          persistentAction: [
            "reply:balance:Узнать баланс бонусов",
            "reply:catalog:Каталог препаратов",
            "reply:order:Сделать заказ",
            "reply:manager:Связаться с менеджером"
          ]
        });
        break;

      case "balance":
      case "узнать баланс бонусов":
        await client.messages.create({
          from: to,
          to: from,
          body: "Пожалуйста, введите ваш ID и пароль через пробел (например: 123456 пароль123)"
        });
        break;

      case "catalog":
      case "каталог препаратов":
        await client.messages.create({
          from: to,
          to: from,
          body: "Вот ссылка на наш каталог: https://peptides1.ru/catalog"
        });
        break;

      case "order":
      case "сделать заказ":
        await client.messages.create({
          from: to,
          to: from,
          body: "Пожалуйста, отправьте список товаров или свяжитесь с менеджером для оформления заказа."
        });
        break;

      case "manager":
      case "связаться с менеджером":
        await client.messages.create({
          from: to,
          to: from,
          body: "Ожидайте, менеджер скоро свяжется с вами."
        });
        break;

      default:
        await client.messages.create({
          from: to,
          to: from,
          body: "Извините, я не понял вас. Напишите 'Привет', чтобы начать заново."
        });
        break;
    }

    // ✔️ Правильный ответ, чтобы Twilio не показывал "OK"
    res.set("Content-Type", "application/json");
    res.status(200).send({});
  } catch (error) {
    console.error("❌ Ошибка при обработке запроса:", error.message);
    res.set("Content-Type", "application/json");
    res.status(200).send({});
  }
});

app.listen(port, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${port}`);
});
