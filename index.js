// Подключение необходимых библиотек
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
require("dotenv").config();
const cron = require("node-cron");

// Создание приложения Express
const app = express();
const PORT = process.env.PORT || 3000;

// Настройка middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Сессии по номерам телефонов
const sessions = {};
const firstMessagesSeen = {};
const logPath = path.join(__dirname, "user_behavior.log");

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

const getPromotionImages = async () => {
  try {
    const response = await axios.get(
      "https://api.github.com/repos/Organicstore151/monthly-promotions/contents/images",
      { headers: { "Accept": "application/vnd.github.v3+json" } }
    );

    const images = response.data
      .filter(file => file.type === "file" && /\.(jpg|jpeg|png)$/i.test(file.name))
      .map(file => `https://organicstore151.github.io/monthly-promotions/images/${file.name}`);

    return images;
  } catch (err) {
    console.error("❌ Не удалось получить список изображений:", err.message);
    return [];
  }
};

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
  if (!sessions[from]) sessions[from] = { step: "waiting_for_command" };
  let message = messageObj.text?.body ||
                messageObj.button?.payload ||
                messageObj.interactive?.button_reply?.id ||
                messageObj.interactive?.list_reply?.id || "";
 if (!firstMessagesSeen[from]) {
  firstMessagesSeen[from] = true;

  const knownCommands = [
    "Сделать заказ",
    "Узнать баланс бонусов",
    "Связаться с менеджером",
    "Каталог препаратов",
    "Прайс-лист",
    "Курс лечения",
    "Главное меню",
    "Акции этого месяца",
    "Сертификаты"
  ];

  if (!knownCommands.includes(message)) {
    await sendTemplateMessage(from, "hello_client");
  }

  logUserAction(from, "new_user_after_restart", message);
}
 // 📸 Обработка фото рецепта
  if (messageObj.type === "image" && sessions[from].step === "waiting_for_order_address") {
    const imageId = messageObj.image.id;
    const imageUrl = `https://graph.facebook.com/v16.0/${imageId}`;
    sessions[from].order = sessions[from].order || {};
    sessions[from].order.imageUrl = imageUrl;
    return res.sendStatus(200); // Ждём текст с адресом
  }
  // 👋 Приветствие новых пользователей
  if (!sessions[from]) {
  sessions[from] = { step: "waiting_for_command" };
  await sendTemplateMessage(from, "hello_client");
  logUserAction(from, "new_user", message);
  return res.sendStatus(200);
}

  const session = sessions[from];
  logUserAction(from, session.step, message);
  
switch (session.step) {
   case "waiting_for_command": {
  if (message === "Узнать баланс бонусов") {
    await sendMessageToMeta(from, "Пожалуйста, введите ваш ID (логин):");
    session.step = "waiting_for_login";
  } else if (message === "1") {
    await sendTemplateMessage(from, "hello_client");
 } else if (message === "Консультация врача") {
  const doctorLink = "https://wa.me/77772419972";
  await sendMessageToMeta(from, `👨‍⚕️ Для консультации с врачом перейдите по ссылке:\n${doctorLink}`);
  } else if (message === "2" || message === "Связаться с менеджером") {
    const managerLink = "https://wa.me/77774991275";
    await sendMessageToMeta(from, `📞 Свяжитесь с менеджером по WhatsApp:\n${managerLink}`);
  } else if (message === "Информация о продукции") {
    await sendTemplateMessage(from, "product_info_menu");
  } else if (message === "Сертификаты") {
    await sendPDF(from, "📄 Ознакомьтесь с нашими сертификатами качества", "https://organicstore151.github.io/certificate/certificates.pdf");
    await sendMessageToMeta(from, "💡 Что вы хотите сделать дальше?\n\n1️⃣ Главное меню\n2️⃣ Связаться с менеджером");
  } else if (message === "Акции этого месяца") {
    const imageLinks = await getPromotionImages();
    if (imageLinks.length === 0) {
      await sendMessageToMeta(from, "❌ Пока нет доступных акций. Попробуйте позже.");
    } else {
      for (const link of imageLinks) {
        await axios.post(
          `https://graph.facebook.com/v16.0/${process.env.PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: "whatsapp",
            to: from,
            type: "image",
            image: { link }
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
      }
    }
  } else if (message === "Каталог препаратов") {
    await sendPDF(from, "📗 Ознакомьтесь с нашим каталогом препаратов", "https://organicstore151.github.io/whatsapp-catalog/catalog.pdf");
    await sendMessageToMeta(from, "💡 Что вы хотите сделать дальше?\n\n1️⃣ Главное меню\n2️⃣ Связаться с менеджером");
  } else if (message === "Курс лечения") {
    await sendPDF(from, "🧪 Рекомендации по применению", "https://organicstore151.github.io/comples/complex.pdf");
    await sendMessageToMeta(from, "💡 Что вы хотите сделать дальше?\n\n1️⃣ Главное меню\n2️⃣ Связаться с менеджером");
  } else if (message === "Прайс-лист") {
    await sendPDF(from, "💰 Актуальный прайс-лист", "https://organicstore151.github.io/price/price.pdf");
    await sendMessageToMeta(from, "💡 Что вы хотите сделать дальше?\n\n1️⃣ Главное меню\n2️⃣ Связаться с менеджером");
  } else if (message === "Связаться с менеджером") {
    const managerLink = "https://wa.me/77774991275";
    await sendMessageToMeta(from, `☎️ Чтобы связаться с менеджером по WhatsApp, нажмите на ссылку:\n${managerLink}`);
  } else if (message === "Сделать заказ") {
    session.order = {};
    session.step = "waiting_for_order_name";
    await sendMessageToMeta(from, "👤 Пожалуйста, укажите ваше имя или ID клиента:");
  } else {
    await sendMessageToMeta(from, "🤖 Я не понял ваш запрос. Выберите действие:\n\n1️⃣ Главное меню\n2️⃣ Связаться с менеджером");
  }
  break;
}
        case "waiting_for_order_name":
      session.order.name = message;
      session.step = "waiting_for_order_items";
      await sendMessageToMeta(from,
        "📝 *Укажите список препаратов, которые вы хотите заказать:*\n\n_Вы также можете прикрепить фото рецепта. Его увидит менеджер._"
      );
      break;

    case "waiting_for_order_items":
      session.order.items = message;
      session.step = "waiting_for_order_address";
      await sendMessageToMeta(from,
        "🏠 *Укажите, пожалуйста, адрес доставки:*\n\n_Без него мы не сможем отправить заказ._"
      );
      break;

    case "waiting_for_order_address":
      session.order.address = message;
      session.step = "waiting_for_order_confirm";
      const summary =  `🧾 Вот ваш заказ:\n\n👤 Имя / ID: ${session.order.name}\n📋 Препараты: ${session.order.items}\n🏠 Адрес: ${session.order.address}` +
                      (session.order.imageUrl ? `\n📸 Фото рецепта: ${session.order.imageUrl}`: "") +
                     `\n\n_Проверьте, всё ли правильно._\n\n1️⃣ Подтвердить и отправить менеджеру\n2️⃣ Отменить заказ`;
      await sendMessageToMeta(from, summary);
      break;

    case "waiting_for_order_confirm":
      if (message === "1") {
        const final = `🛒 Новый заказ:\n\n👤 Имя / ID: ${session.order.name}\n📋 Препараты: ${session.order.items}\n🏠 Адрес: ${session.order.address}\n📞 Телефон: ${from}` +
                      (session.order.imageUrl ? `\n📸 Фото рецепта: ${session.order.imageUrl}` : "");
        await sendMessageToMeta("77774991275", final);
        await sendMessageToMeta(from, "✅ Спасибо! Ваш заказ передан менеджеру. Мы скоро свяжемся с вами.");
        session.step = "waiting_for_command";
        delete session.order;
      } else if (message === "2") {
        await sendMessageToMeta(from, "❌ Заказ отменён. Вы можете начать оформление заново в любое время.");
        session.step = "waiting_for_command";
        delete session.order;
      } else {
        await sendMessageToMeta(from, "🤖 Пожалуйста, выберите:\n1 — Подтвердить заказ\n2 — Отменить заказ");
      }
      break;


    case "waiting_for_login":
      session.login = message;
      session.step = "waiting_for_password";
      await sendMessageToMeta(from, "Спасибо! Теперь введите ваш пароль:");
      break;

    case "waiting_for_password":
      const bonus = await getBonusBalance(session.login, message);
      if (bonus !== null) {
        await sendTemplateMessageWithParams(from, "bonus_client_new", [
          { type: "text", text: bonus.toString() }
        ]);
        console.log(`📤 Отправлен шаблон bonus_client с бонусом: ${bonus}`);
      } else {
        await sendMessageToMeta(from, "❌ Неверный логин или пароль. Попробуйте снова.");
      }
      session.step = "waiting_for_command";
      break;
   } 
  res.sendStatus(200);
});
// Запуск сервера
const sendTestNewsletter = async () => {
  try {
    console.log("🚀 Запуск sendTestNewsletter...");

    // Авторизация на lk.peptides1.ru
    console.log("🔐 Авторизация...");
    const authResponse = await axios.post("https://lk.peptides1.ru/api/auth/sign-in", {
      login: process.env.LOGIN,
      password: process.env.PASSWORD,
    });

    const token = authResponse.data.token;
    console.log("✅ Авторизация успешна");

    // Получение списка партнёров
    console.log("📥 Получение списка партнёров...");
    const partnersResponse = await axios.get(
      "https://lk.peptides1.ru/api/dealers/231253/partners?with_side_volume=true&limit=100&offset=0",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const partners = partnersResponse.data;
    console.log(`👥 Получено партнёров: ${partners.length}`);

    const normalizePhone = (phone) => phone?.replace(/\D/g, "") || "";
    const targetPhone = process.env.TEST_PHONE;

    const target = partners.find((p) =>
      normalizePhone(p.partner?.person?.phone).endsWith(targetPhone)
    );

    if (!target) {
      console.log("❌ Пользователь с таким номером не найден.");
      return;
    }

    const firstName = target.partner?.person?.first_name || "Без имени";
    const middleName = target.partner?.person?.middle_name || "";
    const fullName = `${firstName} ${middleName}`.trim();
    const balance = target.account_balance || 0;

    const recipientPhone = `+${normalizePhone(target.partner?.person?.phone)}`;
    console.log(`📨 Отправка сообщения на ${recipientPhone} (${fullName})...`);

    // Отправка через Meta API
    await axios.post(
  `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
  {
    messaging_product: "whatsapp",
    to: recipientPhone,
    type: "template",
    template: {
      name: "bonus_rassylka", // имя шаблона как указано в Meta
      language: { code: "ru" },
      components: [
        {
          type: "header",
          parameters: [
            { type: "text", text: fullName } // {{1}} в заголовке
          ],
        },
        {
          type: "body",
          parameters: [
            { type: "text", text: balance.toString() } // {{1}} в теле
          ],
        },
      ],
    },
  },
  {
    headers: {
      Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
  }
);

    console.log(`✅ Сообщение успешно отправлено на ${recipientPhone}`);
  } catch (error) {
    console.error("❌ Ошибка при отправке тестовой рассылки:", error?.response?.data || error.message);
  }
};

app.get("/run-newsletter", async (req, res) => {
  try {
    await sendTestNewsletter();
    res.send("📨 Рассылка успешно запущена вручную.");
  } catch (err) {
    console.error("❌ Ошибка при запуске рассылки вручную:", err.message);
    res.status(500).send("❌ Ошибка при запуске рассылки.");
  }
});
app.get("/", (req, res) => {
  res.send("Сервер работает. Добро пожаловать в WhatsApp-бота!");
});
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
