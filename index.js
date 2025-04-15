const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const { logMessage } = require("./logger");

const app = express();
const port = process.env.PORT || 3000;

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

let state = {};
let userData = {};

app.post("/webhook", async (req, res) => {
    const { From, Body, To } = req.body;

    logMessage(`📩 Входящее сообщение: ${JSON.stringify(req.body)}`);

    const userPhoneNumber = From.replace("whatsapp:", "");
    const message = Body.trim();

    // Проверка на пустое сообщение
    if (!message) {
        return res.status(400).send("Пустое сообщение");
    }

    // Логика для разных состояний
    if (state[userPhoneNumber] === "waiting_for_address") {
        userData[userPhoneNumber].address = message;
        state[userPhoneNumber] = "waiting_for_confirmation";

        // Логируем данные
        logMessage(`📝 Лог записан: ${new Date().toISOString()} | ${userPhoneNumber} | ${message}`);

        return sendMessage(userPhoneNumber, "Адрес получен. Подтвердите, если всё верно.");
    }

    if (message.toLowerCase() === "начать") {
        state[userPhoneNumber] = "waiting_for_address";
        userData[userPhoneNumber] = {};
        return sendMessage(userPhoneNumber, "Введите ваш адрес доставки.");
    }

    return res.status(200).send("OK");
});

const sendMessage = async (phoneNumber, message) => {
    try {
        // Проверка, нужно ли использовать MessagingServiceSid или From
        const to = `whatsapp:${phoneNumber}`;
        const from = process.env.TWILIO_WHATSAPP_NUMBER; // Убедитесь, что это правильный номер Twilio

        await client.messages.create({
            to,
            from,
            body: message,
            messagingServiceSid: process.env.MESSAGING_SERVICE_SID, // Используем SID сервиса сообщений
        });

        logMessage(`📩 Сообщение отправлено на ${to}: "${message}"`);
    } catch (error) {
        logMessage(`❌ Ошибка при отправке сообщения на ${phoneNumber}: ${error.message}`);
    }
};

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

