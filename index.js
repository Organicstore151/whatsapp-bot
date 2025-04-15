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
const logPath = path.join(__dirname, "user_behavior.log");

function logUserAction(from, step, message) {
  const data = {
    date: new Date().toISOString(),
    phone: from,
    step,
    message,
  };
  axios.post(process.env.GOOGLE_SHEET_LOG_URL, data).catch(() => {});
  const logLine = `${data.date} | ${data.phone} | ${data.step} | ${data.message}\n`;
  fs.appendFile(logPath, logLine, () => {});
}

// OpenAI SDK
const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ASSISTANT_ID = "asst_TShYE87wBcrCfNAsdH9uK9ni";
const threads = {}; // храним нити ассистента по пользователям

// Основной webhook
app.post("/webhook", async (req, res) => {
  const from = req.body.From;
  const message = (req.body.Body || "").trim();
  const mediaUrl = req.body.MediaUrl0;
  logUserAction(from, "message_received", message);

  if (!message) {
    await sendMessage(from, "❓ Пожалуйста, введите сообщение.");
    return res.send();  // Пустой ответ
  }

  // Создаем нить, если нет
  if (!threads[from]) {
    const thread = await openai.beta.threads.create();
    threads[from] = thread.id;
  }

  const threadId = threads[from];

  // Отправляем сообщение в ассистенту
  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: message,
  });

  const run = await openai.beta.threads.runs.create(threadId, {
    assistant_id: ASSISTANT_ID,
  });

  // Ожидаем завершения run
  let runStatus;
  while (true) {
    runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
    if (runStatus.status === "completed" || runStatus.status === "requires_action") break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Если ассистент хочет вызвать функцию
  if (runStatus.status === "requires_action") {
    const toolCall = runStatus.required_action.submit_tool_outputs.tool_calls[0];
    const { name, arguments: args } = toolCall.function;
    const parsedArgs = JSON.parse(args);

    let result = "";
    if (name === "getBonusBalance") {
      result = await getBonusBalance(parsedArgs.login, parsedArgs.password);
    } else if (name === "sendCatalog") {
      result = await sendPDF(from, "🧾 Каталог препаратов", process.env.CATALOG_URL);
    } else if (name === "sendOrder") {
      result = await sendOrder(parsedArgs, from);
    }

    await openai.beta.threads.runs.submitToolOutputs(threadId, run.id, {
      tool_outputs: [
        {
          tool_call_id: toolCall.id,
          output: result,
        },
      ],
    });

    // Получаем финальный ответ
    const finalRun = await waitForCompletion(threadId, run.id);
    const messages = await openai.beta.threads.messages.list(threadId);
    const last = messages.data.find((m) => m.role === "assistant");
    
    if (!last || !last.content || !last.content[0] || !last.content[0].text || !last.content[0].text.value) {
      await sendMessage(from, "❌ Проблема с ответом. Попробуйте снова.");
      return res.send();  // Пустой ответ
    }

    await sendMessage(from, last.content[0].text.value);
    return res.send();  // Пустой ответ
  }

  // Простой ответ
  const messages = await openai.beta.threads.messages.list(threadId);
  const last = messages.data.find((m) => m.role === "assistant");
  
  if (!last || !last.content || !last.content[0] || !last.content[0].text || !last.content[0].text.value) {
    await sendMessage(from, "❌ Проблема с ответом. Попробуйте снова.");
    return res.send();  // Пустой ответ
  }

  await sendMessage(from, last.content[0].text.value);
  res.send();  // Пустой ответ
});

async function waitForCompletion(threadId, runId) {
  while (true) {
    const run = await openai.beta.threads.runs.retrieve(threadId, runId);
    if (run.status === "completed") return run;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function sendMessage(to, body) {
  await client.messages.create({
    to,
    messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
    body,
  });
}

async function sendPDF(to, caption, mediaUrl) {
  await client.messages.create({
    to,
    messagingServiceSid: process.env.MESSAGING_SERVICE_SID,
    body: caption,
    mediaUrl: [mediaUrl],
  });
  return "📎 Каталог отправлен.";
}

async function getBonusBalance(login, password) {
  try {
    const auth = await axios.post("https://lk.peptides1.ru/api/auth/sign-in", { login, password });
    const token = auth.data.token;
    const closing = await axios.get("https://lk.peptides1.ru/api/partners/current/closing-info", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const amount = closing.data?.current?.balance?.[0]?.amount;
    return amount ? `🎉 Ваш бонусный баланс: ${amount} тг` : "❌ Не удалось получить баланс.";
  } catch {
    return "❌ Неверные логин или пароль.";
  }
}

async function sendOrder(data, from) {
  const orderText = `🛒 Новый заказ:\n👤 Имя: ${data.name}\n📋 Препараты: ${data.items}\n🏠 Адрес: ${data.address}\n📞 Клиент: ${from}`;

  try {
    // Используем правильные переменные окружения
    const messageResponse = await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER, // Получаем номер отправителя из .env
      to: "whatsapp:" + process.env.MANAGER_PHONE, // Получаем номер менеджера из .env
      body: orderText,
    });

    // Проверка на успешную отправку
    if (messageResponse.sid) {
      return "✅ Заказ отправлен менеджеру.";
    } else {
      return "❌ Не удалось отправить заказ менеджеру.";
    }
  } catch (error) {
    console.error("Ошибка при отправке заказа:", error);
    return "❌ Не удалось отправить заказ менеджеру.";
  }
}

app.listen(PORT, () => {
  console.log("👂 Бот слушает на порту", PORT);
});
