// Подключение необходимых библиотек
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// Создание приложения Express
const app = express();
const PORT = process.env.PORT || 3000;

// Настройка middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Сессии по номерам телефонов
const sessions = {};
const logPath = path.join(__dirname, "user_behavior.log");

// Функция сброса сессии
function resetSession(from) {
  sessions[from] = {
    step: "waiting_for_command"
  };
}

// Логирование
function logUserAction(from, step, message) {
  const data = {
    date: new Date().toISOString(),
    phone: from,
    step,
    message,
  };

  axios.post(process.env.GOOGLE_SHEET_WEBHOOK_URL, data)
    .then(() => console.log("📤 Лог отправлен в Google Таблицу"))
    .catch((err) => console.error("❌ Ошибка логирования в таблицу:", err.message));

  const logLine = `${data.date} | ${data.phone} | ${data.step} | ${data.message}\n`;
  fs.appendFile(logPath, logLine, (err) => {
    if (err) console.error("❌ Ошибка записи в лог:", err.message);
    else console.log("📝 Лог записан:", logLine.trim());
  });
}

// Получение бонусов
async function getBonusBalance(login, password) {
  try {
    const authResponse = await axios.post("https://lk.peptides1.ru/api/auth/sign-in", { login, password });
    const token = authResponse.data.token;
    if (!token) return null;

    const balanceResponse = await axios.get("https://lk.peptides1.ru/api/partners/current/closing-info", {
      headers: { Authorization: `Bearer ${token}` },
    });

    return balanceResponse.data.current.balance[0]?.amount || null;
  } catch (error) {
    console.error("❌ Ошибка получения бонусов:", error.message);
    return null;
  }
}

// Отправка текстового сообщения
const sendMessageToMeta = async (to, message) => {
  try {
    await axios.post(
      `https://graph.facebook.com/v16.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message },
      },
      {
        headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
      }
    );
    console.log("📤 Сообщение отправлено:", message);
  } catch (err) {
    console.error("❌ Ошибка при отправке:", err.response?.data || err.message);
  }
};

// Отправка PDF
const sendPDF = async (to, caption, pdfUrl) => {
  try {
    await axios.post(
      `https://graph.facebook.com/v16.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "document",
        document: {
          link: pdfUrl,
          caption,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("📄 PDF отправлен:", caption);
  } catch (err) {
    console.error("❌ Ошибка при отправке PDF:", err.response?.data || err.message);
  }
};

// Шаблон с параметрами — только в header
const sendTemplateMessageWithParams = async (to, templateName, headerParams = []) => {
  try {
    await axios.post(
      `https://graph.facebook.com/v16.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: "ru" },
          components: [
            {
              type: "header",
              parameters: headerParams,
            },
            {
              type: "body",
              parameters: [],
            }
          ]
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`📤 Шаблон "${templateName}" отправлен с параметром`);
  } catch (error) {
    console.error("❌ Ошибка отправки шаблона:", error.response?.data || error.message);
  }
};

// Отправка простого шаблона
const sendTemplateMessage = async (to, templateName) => {
  await sendTemplateMessageWithParams(to, templateName, []);
};

// Webhook верификация
app.get("/webhook", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("✅ Webhook подтвержден");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Обработка входящих сообщений
app.post("/webhook", async (req, res) => {
  const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!messageObj || !messageObj.from) return res.sendStatus(200);

  const from = messageObj.from;
  const isNewUser = !sessions[from];
  if (isNewUser) {
    resetSession(from);
    await sendTemplateMessage(from, "hello_client");
    logUserAction(from, "new_user", "👋 Новый пользователь");
    return res.sendStatus(200);
  }

  if (messageObj.type === "image" && sessions[from].step === "waiting_for_order_address") {
    const imageId = messageObj.image.id;
    const imageUrl = `https://graph.facebook.com/v16.0/${imageId}`;
    sessions[from].order = sessions[from].order || {};
    sessions[from].order.imageUrl = imageUrl;
    return res.sendStatus(200);
  }

  let message = messageObj.text?.body ||
                messageObj.button?.payload ||
                messageObj.interactive?.button_reply?.id ||
                messageObj.interactive?.list_reply?.id || "";

  const session = sessions[from];
  logUserAction(from, session.step, message);

  switch (session.step) {
    case "waiting_for_command":
      if (message === "Узнать баланс бонусов") {
        session.step = "waiting_for_login";
        await sendMessageToMeta(from, "Пожалуйста, введите ваш ID (логин):");
      } else if (message === "Каталог препаратов") {
        await sendPDF(from, "📗 Ознакомьтесь с нашим каталогом препаратов", "https://organicstore151.github.io/whatsapp-catalog/catalog.pdf");
      } else if (message === "Курс лечения") {
        await sendPDF(from, "🧪 Рекомендации по применению", "https://organicstore151.github.io/comples/complex.pdf");
      } else if (message === "Прайс-лист") {
        await sendPDF(from, "💰 Актуальный прайс-лист", "https://organicstore151.github.io/price/price.pdf");
      } else if (message === "Снять бонусы") {
        const managerLink = "https://wa.me/77774991275";
        await sendMessageToMeta(from, `☎️ Чтобы снять бонусы, свяжитесь с менеджером по WhatsApp:\n${managerLink}`);
      } else if (message === "Сделать заказ") {
        resetSession(from);
        session.step = "waiting_for_order_name";
        session.order = {};
        await sendMessageToMeta(from, "👤 Пожалуйста, укажите ваше имя или ID клиента:\n\n_Это нужно, чтобы менеджер связался с вами и уточнил детали._");
      } else {
        await sendMessageToMeta(from, "🤖 Не понял ваш запрос. Доступные команды:\n- Узнать баланс бонусов\n- Каталог препаратов\n- Курс лечения\n- Прайс-лист");
      }
      break;

    case "waiting_for_password":
      const bonus = await getBonusBalance(session.login, message);
      if (bonus !== null) {
        await sendTemplateMessageWithParams(from, "bonus_client", [
          { type: "text", text: bonus.toString() }
        ]);
        console.log(`📤 Отправлен шаблон bonus_client с бонусом: ${bonus}`);
        session.step = "waiting_for_command";
      } else {
        await sendMessageToMeta(from, "❌ Неверный логин или пароль. Попробуйте снова.\n\nПожалуйста, введите ваш ID (логин):");
        session.step = "waiting_for_login";
      }
      break;

    // остальные case остаются без изменений ...

    default:
      session.step = "waiting_for_command";
      await sendMessageToMeta(from, "🤖 Я готов помочь. Например, вы можете узнать бонусы или посмотреть каталог.");
  }

  res.sendStatus(200);
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});

