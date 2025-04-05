const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');

const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.post('/webhook', (req, res) => {
    console.log('Запрос от Twilio:', req.body);  // Логируем весь запрос

    // Получаем необходимые параметры из тела запроса
    const { From, To, Body } = req.body;

    // Проверяем, что все обязательные параметры присутствуют
    if (!From || !To || !Body) {
        return res.status(400).send('Ошибка: не хватает обязательных параметров');
    }

    // Проверяем сообщение и определяем, что делать дальше
    let responseMessage = 'Здравствуйте, чем могу помочь?';
    if (Body.trim().toLowerCase() === 'привет') {
        responseMessage = 'Привет! Чем могу помочь?';
    }

    // Генерация ответа TwiML с кнопками
    const twiml = new twilio.twiml.MessagingResponse();

    const message = twiml.message(responseMessage);
    message.media('https://example.com/some-image.jpg');  // Пример изображения (если нужно)

    // Добавление кнопок
    const buttons = message.addButtons({
        type: 'button',
        text: 'Узнать баланс',
        action: 'action=balance',
    });

    res.type('text/xml');
    res.send(twiml.toString());
});

// Запускаем сервер
app.listen(port, () => {
    console.log(`Сервер запущен на http://localhost:${port}`);
});
