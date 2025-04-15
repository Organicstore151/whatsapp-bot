const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");
const cron = require("node-cron");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const sessions = {};

// ✅ 1. Логирование действий пользователя
function logUserAction(from, step, message) {
  const logLine = `[${new Date().toISOString()}] ${from} | ${step} | ${message}\n`;
  const logPath = path.join(__dirname, "user_behavior.log");

  fs.access(logPath, fs.constants.F_OK, (err) => {
    if (err) {
      fs.writeFile(logPath, "", (err) => {
        if (err) console.error("❌ Ошибка при создании файла:", err.message);
        else console.log("📝 Файл для логов успешно создан.");
      });
    }
  });

  fs.appendFile(logPath, logLine, (err) => {
    if (err) console.error("❌ Ошибка записи в лог:", err.message);
    else console.log("📝 Лог записан:", logLine.trim());
  });
}

// ✅ 2. Анализ логов и построение графика
async function analyzeUserBehavior() {
  const logFile = path.join(__dirname, "user_behavior.log");
  if (!fs.existsSync(logFile)) return;

  const data = fs.readFileSync(logFile, "utf-8");
  const lines = data.trim().split("\n");
  const stepCounts = {};

  for (const line of lines) {
    const match = line.match(/\| (.*?) \|/);
    if (match) {
      const step = match[1].trim();
      stepCounts[step] = (stepCounts[step] || 0) + 1;
    }
  }

  const steps = Object.keys(stepCounts);
  const counts = steps.map((step) => stepCounts[step]);

  const chartCanvas = new ChartJSNodeCanvas({ width: 800, height: 600 });
  const configuration = {
    type: "bar",
    data: {
      labels: steps,
      datasets: [{
        label: "Количество пользователей на каждом этапе",
        data: counts,
        backgroundColor: "rgba(75, 192, 192, 0.6)",
      }],
    },
    options: {
      responsive: false,
      plugins: {
        title: {
          display: true,
          text: "Анализ поведения пользователей WhatsApp-бота",
          font: { size: 20 }
        },
        legend: {
          display: false,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            precision: 0
          }
        }
      }
    },
  };

  const buffer = await chartCanvas.renderToBuffer(configuration);
  const outputPath = path.join(__dirname, "chart.png");
  fs.writeFileSync(outputPath, buffer);
  console.log("📊 График поведения сохранён в chart.png");
}

// ✅ 3. Ежедневный запуск анализа логов в 23:59
cron.schedule("59 23 * * *", async () => {
  console.log("⏰ Запуск анализа логов...");
  await analyzeUserBehavior();
});

app.post("/webhook", async (req, res) => {
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
        body: "*🛒 Для оформления заказа, пожалуйста, отправьте ваше имя или ID клиента.*",
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
        body: "🤖 Извините, я не понял ваш запрос.\n\n1️⃣ — Связаться с менеджером\n2️⃣ — Вернуться к началу",
      });
    }
  }

  else if (session.step === "unrecognized_input") {
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
  }

  else if (session.step === "waiting_for_login") {
    session.login = message;
    session.step = "waiting_for_password";
    await client.messages.create({
      to: from,
      messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
      body: "Теперь введите пароль:",
    });
  }

  else if (session.step === "waiting_for_password") {
    session.password = message;
    session.step = "done";

    try {
      const authResponse = await axios.post("https://lk.peptides1.ru/api/auth/sign-in", {
        login: session.login,
        password: session.password,
      });

      const token = authResponse.data.token;
      const bonusResponse = await axios.get(
        "https://lk.peptides1.ru/api/partners/current/closing-info",
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const bonusAmount = bonusResponse.data?.current?.balance?.[0]?.amount ?? null;

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
      await client.messages.create({
        to: from,
        messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
        body: "❌ Ошибка при получении данных. Проверьте логин и пароль.",
      });
    }

    delete sessions[from];
    return res.status(200).send();
  }

  else if (session.step === "waiting_for_name") {
    session.name = message;
    session.step = "waiting_for_items";
    await client.messages.create({
      to: from,
      messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
      body: "*✍️ Пожалуйста, отправьте список препаратов.*",
    });
  }

  else if (session.step === "waiting_for_items") {
    session.items = message;
    session.step = "waiting_for_address";
    await client.messages.create({
      to: from,
      messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
      body: "*📦 Укажите адрес доставки:*",
    });
  }

  else if (session.step === "waiting_for_address") {
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
      await client.messages.create({
        to: from,
        messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
        body: "❌ Не удалось отправить заказ менеджеру.",
      });
    }

    delete sessions[from];
    return res.status(200).send();
  }

  return res.status(200).send();
});

// ✅ Функция отправки PDF
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
    await client.messages.create({
      to,
      messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
      body: "❌ Не удалось загрузить документ. Попробуйте позже.",
    });
  }
}

app.listen(PORT, () => {
  console.log(`👂 Слушаю на порту ${PORT}`);
});
