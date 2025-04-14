const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const axios = require("axios");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Сессии пользователей
const sessions = {};

// WhatsApp номера
const TWILIO_WHATSAPP_NUMBER = "whatsapp:+77718124038"; // замените на свой номер в .env
const MANAGER_WHATSAPP_NUMBER = "whatsapp:+77774991275";

app.post("/webhook", async (req, res) => {
  console.log("📩 Входящее сообщение:", req.body);

  const from = req.body.From;
  const message = (req.body.Body || "").trim();

  if (!sessions[from]) {
    await sendMessage(from, "👋 Добро пожаловать! Выберите команду:");
    sessions[from] = { step: "waiting_for_command" };
    return res.status(200).send();
  }

  const session = sessions[from];

  if (session.step === "waiting_for_command") {
    if (message === "Сделать заказ") {
      await sendMessage(from, "🛒 Пожалуйста, отправьте ваше ФИО:");
      session.step = "waiting_for_name";
    }
  }

  else if (session.step === "waiting_for_name") {
    session.name = message;
    session.step = "waiting_for_items";
    await sendMessage(from, "✍️ Теперь отправьте список препаратов:");
  }

  else if (session.step === "waiting_for_items") {
    session.items = message;
    session.step = "waiting_for_address";
    await sendMessage(from, "📦 И наконец, введите адрес доставки:");
  }

  else if (session.step === "waiting_for_address") {
    session.address = message;

    const orderText = `🛒 Новый заказ:\n\n👤 ФИО: ${session.name}\n📋 Препараты: ${session.items}\n🏠 Адрес: ${session.address}\n📞 От клиента: ${from}`;

    try {
      // Отправка менеджеру напрямую (если он писал первым!)
      await client.messages.create({
        from: TWILIO_WHATSAPP_NUMBER,
        to: MANAGER_WHATSAPP_NUMBER,
        body: orderText,
      });

      await sendMessage(from, "✅ Спасибо! Ваш заказ принят. Мы свяжемся с вами в ближайшее время.");
    } catch (err) {
      console.error("❌ Ошибка отправки менеджеру:", err.message);
      await sendMessage(from, "⚠️ Мы не смогли отправить заказ менеджеру. Попробуйте позже.");
    }

    delete sessions[from];
    return res.status(200).send();
  }

  return res.status(200).send();
});

async function sendMessage(to, body) {
  try {
    await client.messages.create({
      from: TWILIO_WHATSAPP_NUMBER,
      to,
      body,
    });
  } catch (err) {
    console.error("❌ Ошибка при отправке сообщения:", err.message);
  }
}

app.get("/", (req, res) => {
  res.send("✅ WhatsApp бот работает");
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
