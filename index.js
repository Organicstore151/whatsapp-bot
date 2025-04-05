const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');

const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Обработка GET-запроса на корень
app.get('/', (req, res) => {
    res.send('Сервер работает. Ожидаю запросы на /webhook.');
});

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

    // Создаем объект ответа TwiML
    const twiml = new twilio.twiml.MessagingResponse();

    // Формируем обычное сообщение
    twiml.message('Выберите одну из опций:');

    // Используем правильный формат для интерактивных кнопок
    twiml.message().interactive({
        type: 'button',
        buttons: [
            {
                type: 'reply',
                reply: { id: 'balance', title: 'Узнать баланс' }
            },
            {
                type: 'reply',
                reply: { id: 'help', title: 'Получить помощь' }
            }
        ]
    });

    // Отправляем TwiML
    res.type('text/xml');
    res.send(twiml.toString());
});

// Запускаем сервер
app.listen(port, () => {
    console.log(`Сервер запущен на http://localhost:${port}`);
});
