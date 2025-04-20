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

// Логирование
function logUserAction(from, step, message) {
  const data = {
    date: new Date().toISOString(),
    phone: from,
    step,
    message,
  };

  axios.post(process.env.GOOGLE_SHEET_WEBHOOK_URL, data)
    .then(() => console.log("\ud83d\udce4 Лог отправлен в Google Таблицу"))
    .catch((err) => console.error("\u274c Ошибка логирования в таблицу:", err.message));

  const logLine = `${data.date} | ${data.phone} | ${data.step} | ${data.message}\n`;
  fs.appendFile(logPath, logLine, (err) => {
    if (err) console.error("\u274c Ошибка записи в лог:", err.message);
    else console.log("\ud83d\udcdd Лог записан:", logLine.trim());
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
    console.error("\u274c Ошибка получения бонусов:", error.message);
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
    console.log("\ud83d\udce4 Сообщение отправлено:", message);
  } catch (err) {
    console.error("\u274c Ошибка при отправке:", err.response?.data || err.message);
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
    console.log("\ud83d\udcc4 PDF отправлен:", caption);
  } catch (err) {
    console.error("\u274c Ошибка при отправке PDF:", err.response?.data || err.message);
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
    console.log(`\ud83d\udce4 Шаблон "${templateName}" отправлен с параметром`);
  } catch (error) {
    console.error("\u274c Ошибка отправки шаблона:", error.response?.data || error.message);
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
    console.log("\u2705 Webhook подтвержден");
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
    sessions[from] = { step: "waiting_for_command" };
    await sendTemplateMessage(from, "hello_client");
    logUserAction(from, "new_user", "\ud83d\udc4b Новый пользователь");
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
        await sendMessageToMeta(from, "Пожалуйста, введите ваш ID (логин):");
        session.step = "waiting_for_login";
      } else if (message === "Каталог препаратов") {
        await sendPDF(from, "\ud83d\udcd7 Ознакомьтесь с нашим каталогом препаратов", "https://organicstore151.github.io/whatsapp-catalog/catalog.pdf");
      } else if (message === "Курс лечения") {
        await sendPDF(from, "\ud83e\uddea Рекомендации по применению", "https://organicstore151.github.io/comples/complex.pdf");
      } else if (message === "Прайс-лист") {
        await sendPDF(from, "\ud83d\udcb0 Актуальный прайс-лист", "https://organicstore151.github.io/price/price.pdf");
      } else if (message === "Снять бонусы") {
        const managerLink = "https://wa.me/77774991275";
        await sendMessageToMeta(from, `\u260e\ufe0f Чтобы снять бонусы, свяжитесь с менеджером по WhatsApp:\n${managerLink}`);
      } else if (message === "Сделать заказ") {
  // 💥 Сбросим все предыдущие шаги
  session.step = "waiting_for_order_name";
  session.order = {};
  delete session.login;
  await sendMessageToMeta(from, "👤 Пожалуйста, укажите ваше имя или ID клиента:\n\n_Это нужно, чтобы менеджер связался с вами и уточнил детали._");
}
      } else {
        await sendMessageToMeta(from, "\ud83e\udd16 Не понял ваш запрос. Доступные команды:\n- Узнать баланс бонусов\n- Каталог препаратов\n- Курс лечения\n- Прайс-лист");
      }
      break;

    case "waiting_for_order_name":
      session.order.name = message;
      session.step = "waiting_for_order_items";
      await sendMessageToMeta(from,
        "\ud83d\udcdd *Укажите список препаратов, которые вы хотите заказать:*\n\n_Вы также можете прикрепить фото рецепта. Его увидит менеджер._"
      );
      break;

    case "waiting_for_order_items":
      session.order.items = message;
      session.step = "waiting_for_order_address";
      await sendMessageToMeta(from,
        "\ud83c\udfe0 *Укажите, пожалуйста, адрес доставки:*\n\n_Без него мы не сможем отправить заказ._"
      );
      break;

    case "waiting_for_order_address":
      session.order.address = message;
      session.step = "waiting_for_order_confirm";
      const summary = `\ud83d\uddde Вот ваш заказ:\n\n\ud83d\udc64 Имя / ID: ${session.order.name}\n\ud83d\udccb Препараты: ${session.order.items}\n\ud83c\udfe0 Адрес: ${session.order.address}` +
                      (session.order.imageUrl ? `\n\ud83d\udcf8 Фото рецепта: ${session.order.imageUrl}` : "") +
                      `\n\n_Проверьте, всё ли правильно._\n\n1\ufe0f\u20e3 Подтвердить и отправить менеджеру\n2\ufe0f\u20e3 Отменить заказ`;
      await sendMessageToMeta(from, summary);
      break;

    case "waiting_for_order_confirm":
      if (message === "1") {
        const final = `\ud83d\uded2 Новый заказ:\n\n\ud83d\udc64 Имя / ID: ${session.order.name}\n\ud83d\udccb Препараты: ${session.order.items}\n\ud83c\udfe0 Адрес: ${session.order.address}\n\ud83d\udcf1 Телефон: ${from}` +
                      (session.order.imageUrl ? `\n\ud83d\udcf8 Фото рецепта: ${session.order.imageUrl}` : "");
        await sendMessageToMeta("77774991275", final);
        await sendMessageToMeta(from, "\u2705 Спасибо! Ваш заказ передан менеджеру. Мы скоро свяжемся с вами.");
        session.step = "waiting_for_command";
        delete session.order;
      } else if (message === "2") {
        await sendMessageToMeta(from, "\u274c Заказ отменён. Вы можете начать оформление заново в любое время.");
        session.step = "waiting_for_command";
        delete session.order;
      } else {
        await sendMessageToMeta(from, "\ud83e\udd16 Пожалуйста, выберите:\n1 — Подтвердить заказ\n2 — Отменить заказ");
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
        await sendTemplateMessageWithParams(from, "bonus_client", [
          { type: "text", text: bonus.toString() }
        ]);
        console.log(`\ud83d\udce4 Отправлен шаблон bonus_client с бонусом: ${bonus}`);
      } else {
        await sendMessageToMeta(from, "\u274c Неверный логин или пароль. Попробуйте снова.");
      }
      session.step = "waiting_for_login";
      break;

    default:
      session.step = "waiting_for_command";
      await sendMessageToMeta(from, "\ud83e\udd16 Я готов помочь. Например, вы можете узнать бонусы или посмотреть каталог.");
  }

  res.sendStatus(200);
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`\ud83d\ude80 Сервер запущен на порту ${PORT}`);
});
