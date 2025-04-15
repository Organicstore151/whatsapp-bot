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

// GPT Assistant ID
const ASSISTANT_ID = "asst_TShYE87wBcrCfNAsdH9uK9ni";

// Функция логирования в Google Таблицу и файл
function logUserAction(from, step, message) {
  const data = {
    date: new Date().toISOString(),
    phone: from,
    step,
    message,
  };

  axios.post("https://script.google.com/macros/s/AKfycbyBfgnmgHoklSrxyvkRlVyVDJI960l4BNK8fzWxctoVTTXaVzshADG2ZR6rm-7GBxT02Q/exec", data)
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
    } else if (["Каталог препаратов", "Курс лечения", "Прайс-лист"].includes(message)) {
      const files = {
        "Каталог препаратов": "https://organicstore151.github.io/whatsapp-catalog/catalog.pdf",
        "Курс лечения": "https://organicstore151.github.io/comples/complex.pdf",
        "Прайс-лист": "https://organicstore151.github.io/price/price.pdf",
      };
      await sendPDF(from, `📥 Документ: ${message}`, files[message]);
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
      try {
        const gptResponse = await axios.post("https://api.openai.com/v1/assistants/" + ASSISTANT_ID + "/messages", {
          messages: [{ role: "user", content: message }],
        }, {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
        });
        const reply = gptResponse.data.choices?.[0]?.message?.content || "🤖 Не удалось получить ответ.";
        await client.messages.create({
          to: from,
          messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
          body: reply,
        });
      } catch (err) {
        console.error("❌ Ошибка GPT:", err.message);
        await client.messages.create({
          to: from,
          messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
          body: "🤖 Не удалось обработать запрос. Пожалуйста, свяжитесь с менеджером.",
        });
      }
    }
  }

  // остальные шаги (не изменялись)
  // ...

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
