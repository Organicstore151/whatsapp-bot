const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Сессии
const sessions = {};

app.post("/webhook", async (req, res) => {
  const from = req.body.From;
  const message = req.body.Body?.trim();
  const waNumber = req.body.To;

  console.log(`📩 Сообщение от ${from}: ${message}`);

  // Новая сессия — приветствие с кнопками
  if (!sessions[from]) {
    sessions[from] = { step: "awaiting_selection" };

    await client.messages.create({
      from: waNumber,
      to: from,
      content: {
        body: "Здравствуйте! Я Ваш помощник по продукции Peptides. Чем могу помочь?",
        interactive: {
          type: "button",
          body: {
            text: "Выберите один из вариантов:",
          },
          action: {
            buttons: [
              { type: "reply", reply: { id: "balance", title: "Узнать баланс бонусов" } },
              { type: "reply", reply: { id: "catalog", title: "Каталог препаратов" } },
              { type: "reply", reply: { id: "order", title: "Сделать заказ" } },
              { type: "reply", reply: { id: "manager", title: "Связаться с менеджером" } }
            ],
          },
        },
      },
    });

    return res.sendStatus(200);
  }

  const session = sessions[from];

  // Ответ на кнопку
  if (session.step === "awaiting_selection") {
    switch (message) {
      case "Узнать баланс бонусов":
        await client.messages.create({
          from: waNumber,
          to: from,
          body: "ОК, сейчас проверю ваш бонусный баланс.",
        });
        break;

      case "Каталог препаратов":
        await client.messages.create({
          from: waNumber,
          to: from,
          body: "Вот ссылка на каталог: https://peptides1.ru/catalog",
        });
        break;

      case "Сделать заказ":
        await client.messages.create({
          from: waNumber,
          to: from,
          body: "Пожалуйста, напишите название препарата, который вы хотите заказать.",
        });
        break;

      case "Связаться с менеджером":
        await client.messages.create({
          from: waNumber,
          to: from,
          body: "Наш менеджер скоро свяжется с вами.",
        });
        break;

      default:
        await client.messages.create({
          from: waNumber,
          to: from,
          body: "Пожалуйста, выберите один из вариантов на кнопке.",
        });
        return res.sendStatus(200);
    }

    // Завершаем сессию после ответа
    delete sessions[from];
  }

  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("✅ Бот работает!");
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});
