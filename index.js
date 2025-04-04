const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Проверка сервера
app.get("/", (req, res) => {
  res.send("✅ WhatsApp бот работает");
});

// Webhook Twilio
app.post("/webhook", async (req, res) => {
  const from = req.body.From;
  const body = req.body.Body;

  console.log("📩 Входящее сообщение от:", from, "| Текст:", body);

  try {
    // Отправка шаблона
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: from,
      contentSid: process.env.TEMPLATE_SID
    });

    console.log("✅ Шаблон отправлен");

    // Не возвращаем никакой текст, чтобы избежать "OK"
    res.status(204).end();
  } catch (error) {
    console.error("❌ Ошибка при отправке шаблона:", error);
    res.status(500).send("Ошибка сервера");
  }
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});

