const express = require('express');
const { MessagingResponse } = require('twilio');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.post('/webhook', (req, res) => {
    const twiml = new MessagingResponse();

    // Получаем сообщение от пользователя
    const body = req.body.Body.trim();
    const from = req.body.From;

    // Проверяем нажатие кнопки "Узнать баланс бонусов"
    if (body.toLowerCase() === 'узнать баланс бонусов') {
        const message = twiml.message();
        message.body('Пожалуйста, введите ваш ID пользователя.');

        // Преобразуем это в запрос для ввода ID
        message.interactive({
            type: 'button',
            body: 'Введите ваш ID',
            action: {
                type: 'message',
                message: 'Введите ID'
            }
        });

    } else if (body.toLowerCase() === 'введите id') {
        const message = twiml.message();
        message.body('Теперь, пожалуйста, введите ваш пароль.');

        // Преобразуем это в запрос для ввода пароля
        message.interactive({
            type: 'button',
            body: 'Введите ваш пароль',
            action: {
                type: 'message',
                message: 'Введите пароль'
            }
        });

    } else if (body.toLowerCase() === 'введите пароль') {
        const message = twiml.message();
        message.body('Спасибо! Мы получим ваш баланс бонусов.');

        // Здесь нужно отправить ID и пароль на сервер для получения бонусного баланса
        // (например, через API, который ты настроил на старом личном кабинете)

    } else {
        const message = twiml.message();
        message.body('Здравствуйте! Напишите "Узнать баланс бонусов", чтобы начать.');
    }

    res.type('text/xml');
    res.send(twiml.toString());
});

app.listen(port, () => {
    console.log(`Сервер запущен на http://localhost:${port}`);
});
