const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
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

// Сессии по номерам
const sessions = {};

// Путь к лог-файлу
const logPath = path.join(__dirname, "user_behavior.log");

// Логирование в Google Таблицу и файл
function logUserAction(from, step, message) {
  const data = {
    date: new Date().toISOString(),
    phone: from,
    step,
    message,
  };

  axios
    .post("https://script.google.com/macros/s/YOUR_GOOGLE_SCRIPT_ID/exec", data)
    .then(() => console.log("📤 Лог отправлен в Google Таблицу"))
    .catch((err) => console.error("❌ Ошибка при логировании в таблицу:", err.message));

  const logLine = `${data.date} | ${data.phone} | ${data.step} | ${data.message}\n`;

  fs.appendFile(logPath, logLine, (err) => {
    if (err) console.error("❌ Ошибка записи в лог:", err.message);
    else console.log("📝 Лог записан:", logLine.trim());
  });
}

// Получение бонусов
async function getBonusBalance(login, password) {
  try {
    const authResponse = await axios.post("https://lk.peptides1.ru/api/auth/sign-in", {
      login,
      password,
    });

    const token = authResponse.data.token;
    if (!token) return null;

    const balanceResponse = await axios.get("https://lk.peptides1.ru/api/partners/current/closing-info", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const amount = balanceResponse.data.current.balance[0]?.amount;
    return amount !== undefined ? amount : null;
  } catch (error) {
    console.error("❌ Ошибка при получении бонусов:", error.message);
    return null;
  }
}

// Отправка обычного текстового сообщения
const sendMessageToMeta = async (to, message) => {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v16.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
        },
      }
    );
    console.log("📤 Сообщение отправлено:", message);
  } catch (err) {
    console.error("❌ Ошибка при отправке:", err.response?.data || err.message);
  }
};

// Отправка PDF-файла
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
    console.log("📤 PDF отправлен:", caption);
  } catch (error) {
    console.error("❌ Ошибка при отправке PDF:", error.response?.data || error.message);
  }
};

// Отправка шаблонного сообщения
const sendTemplateMessage = async (to, templateName, headerParams = [], buttons = []) => {
  try {
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: "ru" },
        components: [],
      },
    };

    if (headerParams.length > 0) {
      payload.template.components.push({
        type: "body",
        parameters: headerParams,
      });
    }

    if (buttons.length > 0) {
      payload.template.components.push({
        type: "button",
        sub_type: "url",
        index: 0,
        parameters: buttons,
      });
    }

    await axios.post(
      `https://graph.facebook.com/v16.0/${process.env.PHONE_NUMBER_ID}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`📤 Шаблон "${templateName}" отправлен`);
  } catch (error) {
    console.error("❌ Ошибка шаблона:", error.response?.data || error.message);
  }
};

// Подтверждение вебхука
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Вебхук подтвержден");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Основной webhook
app.post("/webhook", async (req, res) => {
  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  const messages = value?.messages?.[0];

  if (!messages) return res.sendStatus(200);

  const from = messages.from;
  let message = messages.text?.body?.trim() || messages.button?.payload?.trim();

  if (!from || !message) return res.sendStatus(400);

  // Новый пользователь
  if (!sessions[from]) {
    await sendTemplateMessage(from, "hello_client");
    sessions[from] = { step: "waiting_for_command" };
    logUserAction(from, "new_user", message);
    return res.sendStatus(200);
  }

  const session = sessions[from];
  logUserAction(from, session.step, message);

  if (session.step === "waiting_for_command") {
    switch (message) {
      case "Узнать баланс бонусов":
        session.step = "waiting_for_login";
        await sendMessageToMeta(from, "Пожалуйста, отправьте ваш ID (логин):");
        break;
      case "Информация о продукции":
        await sendMessageToMeta(from, "📦 Выберите интересующий раздел:\n\n1. Каталог препаратов\n2. Курс лечения\n3. Прайс-лист");
        break;
      case "Каталог препаратов":
        await sendPDF(from, "📘 Ознакомьтесь с нашим каталогом препаратов:", "https://organicstore151.github.io/whatsapp-catalog/catalog.pdf");
        break;
      case "Курс лечения":
        await sendPDF(from, "📄 Рекомендации по курсам лечения:", "https://organicstore151.github.io/comples/complex.pdf");
        break;
      case "Прайс-лист":
        await sendPDF(from, "💰 Актуальный прайс-лист:", "https://organicstore151.github.io/price/price.pdf");
        break;
      default:
        session.step = "unrecognized_input";
        await sendMessageToMeta(
          from,
          "🤖 Я не понял ваш запрос. Вы можете:\n\n📞 Связаться с менеджером: https://wa.me/77774991275\n🏠 Вернуться в главное меню"
        );
    }
  } else if (session.step === "waiting_for_login") {
    session.login = message;
    session.step = "waiting_for_password";
    await sendMessageToMeta(from, "Введите пароль:");
  } else if (session.step === "waiting_for_password") {
    session.password = message;
    await sendMessageToMeta(from, "⏳ Ищу данные...");

    const bonus = await getBonusBalance(session.login, session.password);

    if (bonus !== null) {
      const params = [{ type: "text", text: `${bonus} ₸` }];
      await sendTemplateMessage(from, "bonus_client", params);
      session.step = "waiting_for_command";
    } else {
      session.step = "waiting_for_login";
      await sendMessageToMeta(from, "❌ Неверный логин или пароль. Попробуйте снова:");
    }
  }

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
