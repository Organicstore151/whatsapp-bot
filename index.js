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
// Получение бонусов
async function getBonusBalance(login, password) {
  try {
    // Авторизация с логином и паролем
    const authResponse = await axios.post("https://lk.peptides1.ru/api/auth/sign-in", {
      login,
      password,
    });

    // Логируем ответ от сервера при авторизации
    console.log("Ответ от сервера при авторизации:", authResponse.data);

    // Проверка наличия токена в ответе
    const token = authResponse.data.token;

    if (!token) {
      console.error("❌ Токен не был получен. Проверьте правильность логина и пароля.");
      return null;
    }

    // Запрос бонусного баланса с использованием токена
    const balanceResponse = await axios.get("https://lk.peptides1.ru/api/partners/current/closing-info", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    // Логируем ответ для проверки
    console.log("Ответ от API при запросе баланса:", balanceResponse.data);

    // Извлекаем сумму баланса
    const amount = balanceResponse.data.current.balance[0]?.amount;

    if (amount === undefined) {
      console.error("❌ Баланс не найден.");
      return null;
    }

    return amount;  // возвращаем сумму баланса

  } catch (error) {
    console.error("❌ Ошибка при получении бонусов:", error.message);
    return null;
  }
}
     
// Отправка обычного сообщения
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
    console.log("Ответ от Meta API:", response.data);
  } catch (err) {
    if (err.response) {
      console.error("❌ Ошибка при отправке сообщения:", err.response.data);
    } else {
      console.error("❌ Ошибка при отправке сообщения:", err.message);
    }
  }
};

// Отправка шаблонного сообщения
const sendTemplateMessage = async (to, templateName) => {
  try {
    await axios.post(
      `https://graph.facebook.com/v16.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        type: "template",
        template: {
          name: templateName,
          language: {
            code: "ru",
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
        },
      }
    );
    console.log(`📤 Шаблонное сообщение "${templateName}" отправлено`);
  } catch (err) {
    if (err.response) {
      console.error("❌ Ошибка при отправке шаблона:", err.response.data);
    } else {
      console.error("❌ Ошибка при отправке шаблона:", err.message);
    }
  }
};

// Подтверждение вебхука от Meta
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Вебхук подтвержден!");
      res.status(200).send(challenge);
    } else {
      console.log("❌ Токен подтверждения не совпадает");
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// Основной webhook для обработки сообщений
app.post("/webhook", async (req, res) => {
  console.log("📩 Входящее сообщение:", JSON.stringify(req.body, null, 2));

  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  const messages = value?.messages?.[0];

  if (!messages) return res.sendStatus(200);

  const from = messages.from;
  let message = null;

  if (messages.text) {
    message = messages.text.body?.trim();
  } else if (messages.button) {
    message = messages.button.payload?.trim();
  }

  if (!from || !message) {
    console.log("❌ Не удалось извлечь номер или текст");
    return res.sendStatus(400);
  }

  // Новый пользователь: шаблон hello_client
  if (!sessions[from]) {
    await sendTemplateMessage(from, "hello_client");
    sessions[from] = { step: "waiting_for_command" };
    logUserAction(from, "new_user", message);
    return res.sendStatus(200);
  }

  const session = sessions[from];
  logUserAction(from, session.step, message);

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
} else if (session.step === "waiting_for_password") {
    session.password = message;
    await sendMessageToMeta(from, "⏳ Получаю информацию...");

    const bonus = await getBonusBalance(session.login, session.password);

    if (bonus !== null) {
      // Отправляем шаблон с бонусами
      const templateParams = [{ type: "text", text: `${bonus} ₸` }];
      
      // Отправка шаблона bonus_client с параметром бонусов
      await sendTemplateMessage(from, "bonus_client", templateParams);
 session.step = "waiting_for_command";
    } else {
      await sendMessageToMeta(from, "❌ Неверный ID или пароль. Попробуйте снова.\n\nВведите ваш ID:");
      session.step = "waiting_for_login";
    }
}
return res.sendStatus(200);
  });
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
