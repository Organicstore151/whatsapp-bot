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
    if (message === "Узнать баланс бонусов") {
      await sendMessage(from, "Пожалуйста, отправьте ваш ID (логин):");
      session.step = "waiting_for_login";
    }

    if (message === "Информация о продукции") {
      try {
        await sendMessage(from, "📄 Ознакомьтесь с нашим каталогом: https://organicstore151.github.io/whatsapp-catalog/catalog.pdf");
      } catch (err) {
        console.error("Ошибка при отправке каталога:", err.message);
        await sendMessage(from, "❌ Не удалось загрузить каталог. Попробуйте позже.");
      }
    }

    if (message === "Каталог препаратов") {
      await sendPDF(from, "🧾 Ознакомьтесь с нашим каталогом препаратов📥", "https://organicstore151.github.io/whatsapp-catalog/catalog.pdf");
    }

    if (message === "Курс лечения") {
      await sendPDF(from, "🩺 Ознакомьтесь с рекомендациями по комплексному применению📥", "https://organicstore151.github.io/comples/complex.pdf");
    }

    if (message === "Прайс-лист") {
      await sendPDF(from, "💰 Ознакомьтесь с актуальным прайс-листом📥", "https://organicstore151.github.io/price/price.pdf");
    }

    if (message === "Сделать заказ") {
      await sendMessage(from, "🛒 Пожалуйста, отправьте ваше ФИО:");
      session.step = "waiting_for_name";
    }

    if (message === "Связаться с менеджером") {
      const managerLink = "https://wa.me/77774991275?text=Здравствуйте";
      await sendMessage(from, `💬 Чтобы связаться с менеджером, нажмите на ссылку ниже:\n${managerLink}`);
    }
  }

  else if (session.step === "waiting_for_login") {
    session.login = message;
    session.step = "waiting_for_password";
    await sendMessage(from, "Теперь введите пароль:");
  }

  else if (session.step === "waiting_for_password") {
    session.password = message;
    session.step = "done";

    try {
      const authResponse = await axios.post(
        "https://lk.peptides1.ru/api/auth/sign-in",
        {
          login: session.login,
          password: session.password,
        }
      );

      const token = authResponse.data.token;

      const bonusResponse = await axios.get(
        "https://lk.peptides1.ru/api/partners/current/closing-info",
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const bonusAmount = bonusResponse.data.current.balance[0].amount;

      await sendMessage(from, `🎉 Ваш бонусный баланс: ${bonusAmount} тг`);
    } catch (err) {
      console.error("Ошибка при получении баланса:", err.message);
      await sendMessage(from, "❌ Ошибка при получении данных. Пожалуйста, проверьте логин и пароль.");
    }

    delete sessions[from];
    return res.status(200).send();
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
      // Отправка менеджеру напрямую
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

// Функция отправки сообщения
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

// Функция отправки PDF
async function sendPDF(to, caption, mediaUrl) {
  try {
    await client.messages.create({
      from: TWILIO_WHATSAPP_NUMBER,
      to,
      body: caption,
      mediaUrl: [mediaUrl],
    });
    console.log("📤 PDF отправлен:", mediaUrl);
  } catch (err) {
    console.error("❌ Ошибка при отправке PDF:", err.message);
    await sendMessage(to, "❌ Не удалось отправить файл. Попробуйте позже.");
  }
}

app.get("/", (req, res) => {
  res.send("✅ WhatsApp бот работает");
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
