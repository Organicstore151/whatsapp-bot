const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const sessions = {};

const logPath = path.join(__dirname, "user_behavior.log");

// Функция логирования в Google Таблицу и файл
function logUserAction(from, step, message) {
  const data = {
    date: new Date().toISOString(),
    phone: from,
    step,
    message,
  };

  // Отправка в Google Таблицу
  axios.post("https://script.google.com/macros/s/AKfycbyBfgnmgHoklSrxyvkRlVyVDJI960l4BNK8fzWxctoVTTXaVzshADG2ZR6rm-7GBxT02Q/exec", data)
    .then(() => console.log("📤 Лог отправлен в Google Таблицу"))
    .catch((err) => console.error("❌ Ошибка при логировании в таблицу:", err.message));

  // Локальное логирование в файл
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

app.post("/webhook", async (req, res) => {
  console.log("📩 Входящее сообщение:", req.body);

  const from = req.body.From;
  const message = (req.body.Body || "").trim();
  const mediaUrl = req.body.MediaUrl0;

  if (!sessions[from]) {
    await client.messages.create({
      to: from,
      messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
      contentSid: process.env.TEMPLATE_SID,
    });
    sessions[from] = { step: "waiting_for_command" };
    logUserAction(from, "new_user", message);
    return res.status(200).send();
  }

  const session = sessions[from];
  logUserAction(from, session.step, message);

  if (mediaUrl) {
    session.recipeImage = mediaUrl;
    await client.messages.create({
      to: from,
      messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
      body: "📸 Фото рецепта получено! Пожалуйста, продолжите оформление заказа.",
    });
  }

  if (session.step === "waiting_for_command") {
    if (message === "Узнать баланс бонусов") {
      await client.messages.create({
        to: from,
        messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
        body: "Пожалуйста, отправьте ваш ID (логин):",
      });
      session.step = "waiting_for_login";
    } else if (message === "Информация о продукции") {
      try {
        await client.messages.create({
          to: from,
          messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
          contentSid: "HXc07f9a56c952dd93c5a4308883e00a7e",
        });
      } catch (err) {
        console.error("Ошибка при отправке шаблона:", err.message);
        await client.messages.create({
          to: from,
          messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
          body: "❌ Не удалось загрузить каталог. Попробуйте позже.",
        });
      }
    } else if (message === "Каталог препаратов") {
      await sendPDF(from, "🧾 Ознакомьтесь с нашим каталогом препаратов📥", "https://organicstore151.github.io/whatsapp-catalog/catalog.pdf");
    } else if (message === "Курс лечения") {
      await sendPDF(from, "🩺 Ознакомьтесь с рекомендациями по комплексному применению📥", "https://organicstore151.github.io/comples/complex.pdf");
    } else if (message === "Прайс-лист") {
      await sendPDF(from, "💰 Ознакомьтесь с актуальным прайс-листом📥", "https://organicstore151.github.io/price/price.pdf");
    } else if (message === "Сделать заказ") {
      await client.messages.create({
        to: from,
        messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
        body: "*🛒 Для оформления заказа, пожалуйста, отправьте ваше имя или ID клиента.*\nЭто нужно, чтобы мы передали заказ менеджеру и он мог с вами связаться:",
      });
      session.step = "waiting_for_name";
    } else if (message === "Связаться с менеджером") {
      const managerLink = "https://wa.me/77774991275?text=Здравствуйте";
      await client.messages.create({
        to: from,
        messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
        body: `💬 Чтобы связаться с менеджером, нажмите на ссылку ниже:\n${managerLink}`,
      });
    } else {
      session.step = "unrecognized_input";
      await client.messages.create({
        to: from,
        messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
        body: "🤖 Извините, я не понял ваш запрос.\n\nВы можете выбрать, что сделать дальше:\n1️⃣ — Связаться с менеджером\n2️⃣ — Вернуться к началу",
      });
    }
  } else if (session.step === "unrecognized_input") {
    if (message === "1") {
      const managerLink = "https://wa.me/77774991275?text=Здравствуйте";
      await client.messages.create({
        to: from,
        messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
        body: `💬 Чтобы связаться с менеджером, нажмите на ссылку ниже:\n${managerLink}`,
      });
      session.step = "waiting_for_command";
    } else if (message === "2") {
      await client.messages.create({
        to: from,
        messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
        contentSid: process.env.TEMPLATE_SID,
      });
      session.step = "waiting_for_command";
    } else {
      await client.messages.create({
        to: from,
        messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
        body: "Пожалуйста, выберите:\n1️⃣ — Менеджер\n2️⃣ — Начать заново",
      });
    }
  } else if (session.step === "waiting_for_login") {
    session.login = message;
    session.step = "waiting_for_password";
    await client.messages.create({
      to: from,
      messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
      body: "Теперь введите пароль:",
    });
  } else if (session.step === "waiting_for_password") {
    session.password = message;
    session.step = "done";
    try {
      const authResponse = await axios.post("https://lk.peptides1.ru/api/auth/sign-in", {
        login: session.login,
        password: session.password,
      });

      const token = authResponse.data.token;

      const bonusResponse = await axios.get("https://lk.peptides1.ru/api/partners/current/closing-info", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const balanceArray = bonusResponse.data?.current?.balance;
      const bonusAmount = Array.isArray(balanceArray) && balanceArray[0]?.amount !== undefined
        ? balanceArray[0].amount
        : null;

      if (bonusAmount !== null) {
        await client.messages.create({
          to: from,
          messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
          body: `🎉 Ваш бонусный баланс: ${bonusAmount} тг`,
        });
      } else {
        await client.messages.create({
          to: from,
          messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
          body: "⚠️ Не удалось получить бонусный баланс.",
        });
      }
    } catch (err) {
      console.error("Ошибка при получении баланса:", err.message);
      await client.messages.create({
        to: from,
        messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
        body: "❌ Проверьте логин и пароль.",
      });
    }
    delete sessions[from];
    return res.status(200).send();
  } else if (session.step === "waiting_for_name") {
    session.name = message;
    session.step = "waiting_for_items";
    await client.messages.create({
      to: from,
      messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
      body: "*✍️ Пожалуйста, отправьте список препаратов или прикрепите фото рецепта:*",
    });
  } else if (session.step === "waiting_for_items") {
    session.items = message;
    session.step = "waiting_for_address";
    await client.messages.create({
      to: from,
      messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
      body: "*📦 Укажите адрес доставки:*",
    });
  } else if (session.step === "waiting_for_address") {
    session.address = message;
    const orderText = `🛒 Новый заказ:\n👤 ФИО: ${session.name}\n📋 Препараты: ${session.items}\n🏠 Адрес: ${session.address}\n📞 От клиента: ${from}\n🖼️ Фото рецепта: ${session.recipeImage || "Не прикреплено"}`;
    try {
      await client.messages.create({
        from: "whatsapp:+77718124038",
        to: "whatsapp:+77774991275",
        body: orderText,
      });
      await client.messages.create({
        to: from,
        messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
        body: "✅ Спасибо! Ваш заказ принят.",
      });
    } catch (err) {
      console.error("❌ Ошибка отправки заказа:", err.message);
      await client.messages.create({
        to: from,
        messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
        body: "❌ Не удалось отправить заказ. Попробуйте позже.",
      });
    }
    delete sessions[from];
    return res.status(200).send();
  }

  return res.status(200).send();
});

async function sendPDF(to, caption, mediaUrl) {
  try {
    await client.messages.create({
      to,
      messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
      body: caption,
      mediaUrl: [mediaUrl],
    });
    console.log("📤 PDF отправлен:", mediaUrl);
  } catch (err) {
    console.error("❌ Ошибка при отправке PDF:", err.message);
    await client.messages.create({
      to,
      messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
      body: "❌ Не удалось загрузить документ.",
    });
  }
}

app.listen(PORT, () => {
  console.log(`👂 Слушаю на порту ${PORT}`);
});
