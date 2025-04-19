// Подключение необходимых библиотек
const express = require("express"); // Для работы с сервером
const bodyParser = require("body-parser"); // Для парсинга тела запросов
const axios = require("axios"); // Для выполнения HTTP запросов
const fs = require("fs"); // Для работы с файловой системой
const path = require("path"); // Для работы с путями файлов
require("dotenv").config(); // Для загрузки переменных окружения из .env файла

// Создание приложения Express
const app = express();
const PORT = process.env.PORT || 3000; // Порт для сервера, по умолчанию 3000

// Настройка middleware для обработки входящих данных
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Обработчик GET запроса на главную страницу
app.get("/", (req, res) => {
  res.send("Привет! Сервер работает.");
});

// Сессии по номерам телефонов клиентов
const sessions = {};

// Путь к файлу для логирования
const logPath = path.join(__dirname, "user_behavior.log");

// Функция логирования действий пользователей
function logUserAction(from, step, message) {
  const data = {
    date: new Date().toISOString(), // Текущая дата и время
    phone: from, // Номер телефона пользователя
    step, // Текущий шаг в процессе
    message, // Сообщение от пользователя
  };

  // Логирование в Google Таблицу
  axios
    .post("https://script.google.com/macros/s/AKfycbyBfgnmgHoklSrxyvkRlVyVDJI960l4BNK8fzWxctoVTTXaVzshADG2ZR6rm-7GBxT02Q/exec", data)
    .then(() => console.log("\ud83d\udce4 Лог отправлен в Google Таблицу"))
    .catch((err) => console.error("\u274c Ошибка при логировании в таблицу:", err.message));

  // Запись в файл логов
  const logLine = `${data.date} | ${data.phone} | ${data.step} | ${data.message}\n`;

  fs.access(logPath, fs.constants.F_OK, (err) => {
    if (err) {
      // Если файл не существует, создаем его
      fs.writeFile(logPath, logLine, (err) => {
        if (err) console.error("\u274c Ошибка при создании файла:", err.message);
        else console.log("\ud83d\udcdd Файл логов создан и лог записан.");
      });
    } else {
      // Если файл существует, добавляем в него новую запись
      fs.appendFile(logPath, logLine, (err) => {
        if (err) console.error("\u274c Ошибка записи в лог:", err.message);
        else console.log("\ud83d\udcdd Лог записан:", logLine.trim());
      });
    }
  });
}

// Функция получения бонусов с внешнего API
async function getBonusBalance(login, password) {
  try {
    // Авторизация и получение токена
    const authResponse = await axios.post("https://lk.peptides1.ru/api/auth/sign-in", {
      login,
      password,
    });

    console.log("Ответ от сервера при авторизации:", authResponse.data);
    const token = authResponse.data.token;

    if (!token) {
      console.error("\u274c Токен не был получен. Проверьте правильность логина и пароля.");
      return null;
    }

    // Запрос баланса по полученному токену
    const balanceResponse = await axios.get("https://lk.peptides1.ru/api/partners/current/closing-info", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    console.log("Ответ от API при запросе баланса:", balanceResponse.data);
    const amount = balanceResponse.data.current.balance[0]?.amount;

    if (amount === undefined) {
      console.error("\u274c Баланс не найден.");
      return null;
    }

    return amount; // Возвращаем найденный баланс
  } catch (error) {
    console.error("\u274c Ошибка при получении бонусов:", error.message);
    return null;
  }
}

// Функция отправки текстовых сообщений через Meta WhatsApp API
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
    console.log("\ud83d\udce4 Сообщение отправлено:", message);
    console.log("Ответ от Meta API:", response.data);
  } catch (err) {
    if (err.response) {
      console.error("\u274c Ошибка при отправке сообщения:", err.response.data);
    } else {
      console.error("\u274c Ошибка при отправке сообщения:", err.message);
    }
  }
};

// Функция отправки шаблонных сообщений через Meta WhatsApp API
const sendTemplateMessage = async (to, templateName, headerParams = [], buttons = []) => {
  try {
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: "ru" },
        components: []
      }
    };

    // Добавление параметров в заголовок шаблона
    if (headerParams.length > 0) {
      payload.template.components.push({
        type: "header",
        parameters: headerParams
      });
    }

    // Добавление кнопок в шаблон
    if (buttons.length > 0) {
      payload.template.components.push({
        type: "button",
        sub_type: "url",
        index: 0,
        parameters: buttons
      });
    }

    // Отправка шаблона через Meta API
    const response = await axios.post(
      `https://graph.facebook.com/v16.0/${process.env.PHONE_NUMBER_ID}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log(`\ud83d\udce4 Шаблонное сообщение "${templateName}" отправлено с параметрами`);
  } catch (error) {
    console.error("\u274c Ошибка при отправке шаблона:", error.response?.data || error.message);
  }
};

// Подтверждение вебхука от Meta для валидации
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("\u2705 Вебхук подтвержден!");
      res.status(200).send(challenge);
    } else {
      console.log("\u274c Токен подтверждения не совпадает");
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// Основной обработчик POST запроса от Meta (получение сообщений)
app.post("/webhook", async (req, res) => {
  console.log("\ud83d\udce9 Входящее сообщение:", JSON.stringify(req.body, null, 2));

  // Извлечение данных о сообщении
  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  const messages = value?.messages?.[0];

  if (!messages) return res.sendStatus(200);

  const from = messages.from;
  let message = null;

  // Обработка различных типов сообщений (текст, кнопки и т. д.)
  if (messages.text) {
    message = messages.text.body?.trim();
  } else if (messages.button) {
    message = messages.button.payload?.trim();
  } else if (messages.interactive?.button_reply) {
    message = messages.interactive.button_reply.id?.trim();
  } else if (messages.interactive?.list_reply) {
    message = messages.interactive.list_reply.id?.trim();
  }

  if (!from || !message) {
    console.log("\u274c Не удалось извлечь номер или текст");
    return res.sendStatus(400);
  }

  // Если сессия пользователя новая, отправляем приветственное сообщение
  if (!sessions[from]) {
    await sendTemplateMessage(from, "hello_client");
    sessions[from] = { step: "waiting_for_command" };
    logUserAction(from, "new_user", message);
    return res.sendStatus(200);
  }

  // Логика обработки различных шагов сессии
  const session = sessions[from];
  logUserAction(from, session.step, message);

  if (session.step === "waiting_for_command") {
    if (message === "Узнать баланс бонусов") {
      await sendMessageToMeta(from, "Пожалуйста, отправьте ваш ID (логин):");
      session.step = "waiting_for_login";
    } else if (message === "Информация о продукции") {
      await sendMessageToMeta(from, "Вот информация о продукции...");
    } else if (message === "Каталог препаратов") {
      await sendPDF(from, "\ud83d\udcdf Ознакомьтесь с нашим каталогом препаратов\ud83d\udcc5", "https://organicstore151.github.io/whatsapp-catalog/catalog.pdf");
    } else if (message === "Курс лечения") {
      await sendPDF(from, "\ud83e\ude7a Ознакомьтесь с рекомендациями по комплексному применению\ud83d\udcc5", "https://organicstore151.github.io/comples/complex.pdf");
    } else if (message === "Прайс-лист") {
      await sendPDF(from, "\ud83d\udcb0 Ознакомьтесь с актуальным прайс-листом\ud83d\udcc5", "https://organicstore151.github.io/price/price.pdf");
    } else {
      session.step = "unrecognized_input";
      await sendMessageToMeta(from, "\ud83e\udd16 Извините, я не понял ваш запрос.\n\nВы можете выбрать, что сделать дальше:\n1\ufe0f\u20e3 — Связаться с менеджером\n2\ufe0f\u20e3 — Главное меню");
    }
  } else if (session.step === "waiting_for_login") {
    session.login = message;
    session.step = "waiting_for_password";
    await sendMessageToMeta(from, "Теперь введите пароль:");
  } else if (session.step === "waiting_for_password") {
    session.password = message;
    await sendMessageToMeta(from, "\u23f3 Получаю информацию...");

    const bonus = await getBonusBalance(session.login, session.password);

    if (bonus !== null) {
  const templateParams = [{ type: "text", text: `${bonus} ₸` }];
  const buttons = [
    {
      type: "url",
      title: "Связаться с менеджером",
      url: "https://wa.me/77774991275?text=Здравствуйте,%20хочу%20снять%20бонусы"
    }
  ];
  await sendTemplateMessage(from, "bonus_client", templateParams);
       // Отправляем сообщение с ссылкой на WhatsApp менеджера, спрятанную в слово "Whatsapp"
  const message = "Если хотите снять бонусы, нажмите на ссылку: [Whatsapp](https://wa.me/77774991275?text=Здравствуйте,%20хочу%20снять%20бонусы).";
  await sendMessageToMeta(from, message);

  session.step = "waiting_for_command";
}
  }
  return res.sendStatus(200);
});

// Запуск сервера на указанном порту
app.listen(PORT, () => {
  console.log(`\ud83d\ude80 Сервер запущен на порту ${PORT}`);
});
