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
  const message = req.body.Body.trim();
  const waNumber = req.body.To;

  if (!sessions[from]) {
    // Приветственное сообщение с кнопками
    await client.messages.create({
      from: waNumber,
      to: from,
      contentSid: undefined,
      content: {
        interactive: {
          type: "button",
          body: {
            text: "👋 Добро пожаловать! Выберите действие:",
          },
          action: {
            buttons: [
              {
                type: "reply",
                reply: {
                  id: "check_bonus",
                  title: "Узнать баланс бонусов",
                },
              },
              {
                type: "reply",
                reply: {
                  id: "catalog",
                  title: "Каталог товаров",
                },
              },
            ],
          },
        },
      },
    });
    sessions[from] = { step: "waiting_for_command" };
    return res.sendStatus(200);
  }

  const session = sessions[from];

  // Проверка кнопки
  if (session.step === "waiting_for_command") {
    if (message === "Узнать баланс бонусов") {
      await client.messages.create({
        from: waNumber,
        to: from,
        body: "Пожалуйста, отправьте ваш ID (логин):",
      });
      session.step = "waiting_for_login";
    } else if (message === "Каталог товаров") {
      // Отправка URL-кнопки
      await client.messages.create({
        from: waNumber,
        to: from,
        contentSid: undefined,
        content: {
          interactive: {
            type: "button",
            body: {
              text: "📦 Нажмите на кнопку ниже, чтобы открыть каталог препаратов:",
            },
            action: {
              buttons: [
                {
                  type: "url",
                  url: process.env.CATALOG_URL, // ссылка на каталог
                  title: "Открыть каталог",
                },
              ],
            },
          },
        },
      });
    }
  }

  return res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("✅ WhatsApp бот работает");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
