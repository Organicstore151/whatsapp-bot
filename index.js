const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");  // axios для запросов к Meta API
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.send("Привет! Сервер работает.");
});


const sessions = {};

const logPath = path.join(__dirname, "user_behavior.log");

function logUserAction(from, step, message) {
  const data = {
    date: new Date().toISOString(),
    phone: from,
    step,
    message,
  };

  axios
    .post("https://script.google.com/macros/s/AKfycbyBfgnmgHoklSrxyvkRlVyVDJI960l4BNK8fzWxctoVTTXaVzshADG2ZR6rm-7GBxT02Q/exec", data)
    .then(() => console.log("📤 Лог отправлен в Google Таблицу"))
    .catch((err) => console.error("❌ Ошибка при логировании в таблицу:", err.message));

  const logLine = `${data.date} | ${data.phone} | ${data.step} | ${data.message}\n`;

  fs.access(logPath, fs.constants.F_OK, (err) => {
    if (err) {
      fs.writeFile(logPath, logLine, (err) => {
        if (err) console.error("❌ Ошибка при создании файла:", err.message);
        else console.log("📝 Файл логов создан и лог записан.");
      });
    } else {
      fs.appendFile(logPath, logLine, (err) => {
        if (err) console.error("❌ Ошибка записи в лог:", err.message);
        else console.log("📝 Лог записан:", logLine.trim());
      });
    }
  });
}

const sendMessageToMeta = async (to, message) => {
  try {
    const response = await axios.post(`https://graph.facebook.com/v16.0/${process.env.PHONE_NUMBER_ID}/messages`, {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: message },
    }, {
      headers: {
        Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
      },
    });
    console.log("📤 Сообщение отправлено:", message);
    console.log("Ответ от Meta API:", response.data);
  } catch (err) {
    if (err.response) {
      // Логирование подробностей ошибки
      console.error("❌ Ошибка при отправке сообщения:", err.response.data);
    } else {
      console.error("❌ Ошибка при отправке сообщения:", err.message);
    }
  }
};
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // Ваш токен подтверждения (это значение вы указываете при настройке вебхука в Meta)
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Вебхук подтвержден!");
      // Отправляем challenge обратно в ответ
      res.status(200).send(challenge);
    } else {
      console.log("❌ Токен подтверждения не совпадает");
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});
app.post("/webhook", async (req, res) => {
  console.log("📩 Входящее сообщение:", req.body);

  const from = req.body.From;
  const message = (req.body.Body || "").trim();
  const mediaUrl = req.body.MediaUrl0;

  if (!sessions[from]) {
    // Отправка первого шаблона (например, приветствие)
    await sendMessageToMeta(from, "Привет! Как я могу помочь?");

    // Инициализация сессии
    sessions[from] = { step: "waiting_for_command" };

    // Логирование
    logUserAction(from, "new_user", message);

    return res.status(200).send();
  }

  const session = sessions[from];
  logUserAction(from, session.step, message);

  if (mediaUrl) {
    session.recipeImage = mediaUrl;
    await sendMessageToMeta(from, "📸 Фото рецепта получено! Пожалуйста, продолжите оформление заказа.");
  }

  if (session.step === "waiting_for_command") {
    if (message === "Узнать баланс бонусов") {
      await sendMessageToMeta(from, "Пожалуйста, отправьте ваш ID (логин):");
      session.step = "waiting_for_login";
    } else if (message === "Информация о продукции") {
      await sendMessageToMeta(from, "Вот информация о продукции...");
    } else if (message === "Каталог препаратов") {
      await sendPDF(from, "🧾 Ознакомьтесь с нашим каталогом препаратов📥", "https://organicstore151.github.io/whatsapp-catalog/catalog.pdf");
    } else if (message === "Курс лечения") {
      await sendPDF(from, "🩺 Ознакомьтесь с рекомендациями по комплексному применению📥", "https://organicstore151.github.io/comples/complex.pdf");
    } else if (message === "Прайс-лист") {
      await sendPDF(from, "💰 Ознакомьтесь с актуальным прайс-листом📥", "https://organicstore151.github.io/price/price.pdf");
    } else {
      session.step = "unrecognized_input";
      await sendMessageToMeta(from, "🤖 Извините, я не понял ваш запрос.\n\nВы можете выбрать, что сделать дальше:\n1️⃣ — Связаться с менеджером\n2️⃣ — Главное меню");
    }
  } else if (session.step === "waiting_for_login") {
    session.login = message;
    session.step = "waiting_for_password";
    await sendMessageToMeta(from, "Теперь введите пароль:");
  }

  return res.status(200).send();
});

const sendPDF = async (to, caption, mediaUrl) => {
  try {
    await axios.post(`https://graph.facebook.com/v16.0/${process.env.WHATSAPP_BUSINESS_ACCOUNT_ID}/messages`, {
      messaging_product: "whatsapp",
      to: to,
      text: { body: caption },
      media: { link: mediaUrl },
    }, {
      headers: {
        Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
      },
    });
    console.log("📤 PDF отправлен:", mediaUrl);
  } catch (err) {
    console.error("❌ Ошибка при отправке PDF через Meta API:", err.message);
  }
};

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
