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

// Хранилище сессий пользователей
const sessions = {};

// Webhook для входящих сообщений
app.post("/webhook", async (req, res) => {
  const from = req.body.From;
  const message = (req.body.Body || "").trim();
  const waNumber = req.body.To;

  // Новая сессия — отправить стартовый шаблон
  if (!sessions[from]) {
    sessions[from] = { step: "waiting_for_command" };
    await client.messages.create({
      from: waNumber,
      to: from,
      contentSid: process.env.TEMPLATE_SID,
    });
    return res.status(200).send();
  }

  const session = sessions[from];

  // === Главное меню ===
  if (session.step === "waiting_for_command") {
    if (message === "Узнать баланс бонусов") {
      session.step = "waiting_for_login";
      await client.messages.create({
        from: waNumber,
        to: from,
        body: "Пожалуйста, отправьте ваш ID (логин):",
      });
    }

    else if (message === "Информация о продукции") {
      try {
        await client.messages.create({
          from: waNumber,
          to: from,
          contentSid: "HXc07f9a56c952dd93c5a4308883e00a7e",
        });
      } catch (err) {
        console.error("Ошибка при отправке шаблона:", err.message);
        await client.messages.create({
          from: waNumber,
          to: from,
          body: "❌ Не удалось загрузить каталог. Попробуйте позже.",
        });
      }
    }

    else if (message === "Каталог препаратов") {
      await sendPDF(
        waNumber,
        from,
        "🧾 Ознакомьтесь с нашим каталогом препаратов📥",
        "https://organicstore151.github.io/whatsapp-catalog/catalog.pdf"
      );
    }

    else if (message === "Курс лечения") {
      await sendPDF(
        waNumber,
        from,
        "🩺 Ознакомьтесь с рекомендациями по комплексному применению📥",
        "https://organicstore151.github.io/comples/complex.pdf"
      );
    }

    else if (message === "Прайс-лист") {
      await sendPDF(
        waNumber,
        from,
        "💰 Ознакомьтесь с актуальным прайс-листом📥",
        "https://organicstore151.github.io/price/price.pdf"
      );
    }

    else if (message === "Сделать заказ") {
      session.step = "order_waiting_for_name";
      await client.messages.create({
        from: waNumber,
        to: from,
        body: "📝 Пожалуйста, укажите ваше ФИО:",
      });
    }
  }

  // === Получение логина и пароля ===
  else if (session.step === "waiting_for_login") {
    session.login = message;
    session.step = "waiting_for_password";
    await client.messages.create({
      from: waNumber,
      to: from,
      body: "Теперь введите пароль:",
    });
  }

  else if (session.step === "waiting_for_password") {
    session.password = message;

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

      await client.messages.create({
        from: waNumber,
        to: from,
        body: `🎉 Ваш бонусный баланс: ${bonusAmount} тг`,
      });
    } catch (err) {
      console.error("Ошибка при получении баланса:", err.message);
      await client.messages.create({
        from: waNumber,
        to: from,
        body: "❌ Ошибка при получении данных. Пожалуйста, проверьте логин и пароль.",
      });
    }

    delete sessions[from];
    return res.status(200).send();
  }

  // === Заказ: шаг 1 — ФИО ===
  else if (session.step === "order_waiting_for_name") {
    session.orderName = message;
    session.step = "order_waiting_for_items";
    await client.messages.create({
      from: waNumber,
      to: from,
      body: "📦 Укажите, что вы хотите заказать (название препарата и количество):",
    });
  }

  // === Заказ: шаг 2 — препараты ===
  else if (session.step === "order_waiting_for_items") {
    session.orderItems = message;
    session.step = "order_waiting_for_address";
    await client.messages.create({
      from: waNumber,
      to: from,
      body: "🏠 Укажите, пожалуйста, адрес доставки:",
    });
  }

  // === Заказ: шаг 3 — адрес ===
  else if (session.step === "order_waiting_for_address") {
    session.orderAddress = message;
    session.step = "done";

    const summary = `✅ Спасибо за ваш заказ!\n\n👤 ФИО: ${session.orderName}\n📦 Заказ: ${session.orderItems}\n🏠 Адрес: ${session.orderAddress}\n\nМы скоро свяжемся с вами для подтверждения.`;

    await client.messages.create({
      from: waNumber,
      to: from,
      body: summary,
    });

    // Здесь можно добавить отправку данных в админку/Google Sheets

    delete sessions[from];
    return res.status(200).send();
  }

  return res.status(200).send();
});

// === Функция отправки PDF ===
async function sendPDF(from, to, caption, mediaUrl) {
  try {
    await client.messages.create({
      from,
      to,
      body: caption,
      mediaUrl: [mediaUrl],
    });
    console.log("PDF отправлен:", mediaUrl);
  } catch (err) {
    console.error("Ошибка при отправке PDF:", err.message);
    await client.messages.create({
      from,
      to,
      body: "❌ Не удалось отправить файл. Попробуйте позже.",
    });
  }
}

app.get("/", (req, res) => {
  res.send("✅ WhatsApp бот работает");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
