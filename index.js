const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const sessions = {}; // Храним инфу по каждому юзеру

app.post("/webhook", async (req, res) => {
  const from = req.body.From;
  const to = req.body.To;
  const message = req.body.Body?.trim();

  console.log("📦 Полный req.body:", req.body);
  console.log(`📩 Сообщение от ${from}: ${message}`);

  if (!from || !to) {
    console.error("❌ Не хватает параметров 'from' или 'to'");
    return res.sendStatus(400);
  }

  const action = message?.toLowerCase() || "";
  console.log(`🆔 Action: ${action}`);

  try {
    if (!sessions[from]) {
      sessions[from] = { step: "started" };

      await client.messages.create({
        from: to,
        to: from,
        body: "Здравствуйте! Я Ваш помощник по продукции Peptides. Чем могу помочь?",
        persistentAction: [
          "reply:balance:Узнать баланс бонусов",
          "reply:catalog:Каталог препаратов",
          "reply:order:Сделать заказ",
          "reply:manager:Связаться с менеджером"
        ]
      });

      return res.sendStatus(200);
    }

    // Обработка выбора
    switch (action) {
      case "узнать баланс бонусов":
        await client.messages.create({
          from: to,
          to: from,
          body: "ОК, сейчас проверю ваш бонусный баланс."
        });
        break;

      case "каталог препаратов":
        await client.messages.create({
          from: to,
          to: from,
          body: "Вот ссылка на каталог: https://peptides1.ru/catalog"
        });
        break;

      case "сделать заказ":
        await client.messages.create({
          from: to,
          to: from,
          body: "Пожалуйста, напишите название препарата, который вы хотите заказать."
        });
        break;

      case "связаться с менеджером":
        await client.messages.create({
          from: to,
          to: from,
          body: "Наш менеджер скоро свяжется с вами."
        });
        break;

      default:
        await client.messages.create({
          from: to,
          to: from,
          body: "Пожалуйста, выберите один из вариантов на кнопке."
        });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Ошибка при обработке запроса:", err.message);
    res.sendStatus(500);
  }
});

app.get("/", (req, res) => {
  res.send("✅ Бот работает!");
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});
