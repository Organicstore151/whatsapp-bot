const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const sessions = {};

app.post("/webhook", async (req, res) => {
  const from = req.body.From;
  const waNumber = req.body.To;
  const message = req.body.Body?.trim();
  const payload = req.body.ButtonPayload;
  const action = payload || message;

  console.log("📦 Полный req.body:", req.body);
  console.log(`📩 Сообщение от ${from}: ${message}`);
  console.log(`🆔 Action: ${action}`);

  if (!sessions[from]) {
    sessions[from] = { step: "started" };

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

  switch (action.toLowerCase()) {
    case "balance":
    case "узнать баланс бонусов":
      await client.messages.create({
        from: waNumber,
        to: from,
        body: "ОК, сейчас проверю ваш бонусный баланс.",
      });
      break;

    case "catalog":
    case "каталог препаратов":
      await client.messages.create({
        from: waNumber,
        to: from,
        body: "Вот ссылка на каталог: https://peptides1.ru/catalog",
      });
      break;

    case "order":
    case "сделать заказ":
      await client.messages.create({
        from: waNumber,
        to: from,
        body: "Пожалуйста, напишите название препарата, который вы хотите заказать.",
      });
      break;

    case "manager":
    case "связаться с менеджером":
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
  }

  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("✅ Бот работает!");
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});
