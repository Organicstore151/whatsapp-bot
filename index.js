// index.js
require('dotenv').config();
const express = require('express');
const { MessagingResponse } = require('twilio').twiml;
const axios = require('axios');
const fs = require('fs');
const { OpenAI } = require('openai');

const app = express();
app.use(express.urlencoded({ extended: false }));

const sessions = {};
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function logBehavior(phone, step, message) {
  const log = `${new Date().toISOString()} | ${phone} | ${step} | ${message}\n`;
  fs.appendFileSync('user_behavior.log', log);
  console.log('📝 Лог записан:', log.trim());
}

async function handleGPTFallback(message, phone) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content:
          'Ты вежливый и профессиональный помощник интернет-магазина Peptides. Отвечай кратко и по делу. Предлагай клиенту узнать бонусный баланс, отправить каталог, оформить заказ или связать с менеджером. Для оформления заказа спроси ФИО и ID клиента. Клиент может прикрепить фото рецепта.',
      },
      { role: 'user', content: message },
    ],
  });

  return completion.choices[0].message.content;
}

app.post('/incoming', async (req, res) => {
  const twiml = new MessagingResponse();
  const msg = twiml.message();
  const from = req.body.From;
  const body = req.body.Body?.trim();
  const phone = from.replace('whatsapp:', '');

  console.log('Получено сообщение от', phone, ':', body);

  if (!sessions[phone]) sessions[phone] = { step: null, data: {} };
  const session = sessions[phone];

  try {
    if (body.toLowerCase().includes('баланс')) {
      session.step = 'awaiting_id';
      msg.body('Пожалуйста, введите ваш ID клиента:');
      logBehavior(from, 'request_id', body);
    } else if (session.step === 'awaiting_id') {
      session.data.id = body;
      session.step = 'awaiting_password';
      msg.body('Теперь введите ваш пароль:');
      logBehavior(from, 'request_password', body);
    } else if (session.step === 'awaiting_password') {
      session.data.password = body;
      try {
        const auth = await axios.post('https://lk.peptides1.ru/api/auth/sign-in', {
          login: session.data.id,
          password: session.data.password,
        });
        const token = auth.data.token;
        const closing = await axios.get('https://lk.peptides1.ru/api/partners/current/closing-info', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const amount = closing.data.balance[0].amount;
        msg.body(`Ваш бонусный баланс: ${amount} ₸`);
        logBehavior(from, 'bonus_response', `${amount} ₸`);
        sessions[phone] = { step: null, data: {} };
      } catch (e) {
        console.error('Ошибка при авторизации:', e);
        msg.body('Ошибка при входе. Проверьте ID и пароль.');
        logBehavior(from, 'login_failed', body);
      }
    } else if (body.toLowerCase().includes('каталог')) {
      msg.media('https://organicstore151.github.io/whatsapp-catalog/catalog.pdf');
      msg.body('Вот каталог продукции 📄');
      logBehavior(from, 'send_catalog', body);
    } else if (body.toLowerCase().includes('курс')) {
      msg.media('https://organicstore151.github.io/comples/therapy.pdf');
      msg.body('Вот рекомендованный курс лечения 📄');
      logBehavior(from, 'send_course', body);
    } else if (body.toLowerCase().includes('прайс')) {
      msg.media('https://organicstore151.github.io/price/price.pdf');
      msg.body('Вот прайс-лист 📄');
      logBehavior(from, 'send_price', body);
    } else if (body.toLowerCase().includes('заказ')) {
      session.step = 'order_name';
      msg.body('Пожалуйста, отправьте ваше ФИО:');
      logBehavior(from, 'order_start', body);
    } else if (session.step === 'order_name') {
      session.data.name = body;
      session.step = 'order_id';
      msg.body('Укажите ваш ID клиента:');
      logBehavior(from, 'order_name', body);
    } else if (session.step === 'order_id') {
      session.data.clientId = body;
      session.step = 'order_products';
      msg.body('Теперь напишите список препаратов:');
      logBehavior(from, 'order_id', body);
    } else if (session.step === 'order_products') {
      session.data.products = body;
      session.step = 'order_address';
      msg.body('Укажите адрес доставки:');
      logBehavior(from, 'order_products', body);
    } else if (session.step === 'order_address') {
      session.data.address = body;
      const text = `Новый заказ:\nФИО: ${session.data.name}\nID клиента: ${session.data.clientId}\nПрепараты: ${session.data.products}\nАдрес: ${session.data.address}`;

      try {
        await axios.post('https://api.twilio.com/2010-04-01/Accounts/' + process.env.TWILIO_ACCOUNT_SID + '/Messages.json',
          new URLSearchParams({
            To: 'whatsapp:' + process.env.MANAGER_PHONE,
            From: process.env.TWILIO_WHATSAPP_NUMBER,
            Body: text,
          }),
          {
            auth: {
              username: process.env.TWILIO_ACCOUNT_SID,
              password: process.env.TWILIO_AUTH_TOKEN,
            },
          }
        );

        msg.body('Ваш заказ принят! Менеджер скоро с вами свяжется.');
        logBehavior(from, 'order_complete', text);
        sessions[phone] = { step: null, data: {} };
      } catch (error) {
        console.error('Ошибка при отправке сообщения менеджеру:', error);
        msg.body('Произошла ошибка при отправке заказа. Попробуйте снова.');
        logBehavior(from, 'order_failed', body);
      }
    } else {
      const gptResponse = await handleGPTFallback(body, from);
      msg.body(gptResponse);
      logBehavior(from, 'unrecognized_input', body);
    }
  } catch (err) {
    console.error('❌ Ошибка при обработке запроса:', err);
    msg.body('Произошла ошибка. Попробуйте позже.');
    logBehavior(from, 'error', body);
  }

  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

app.listen(process.env.PORT || 3000, () => {
  console.log('🚀 Сервер запущен на порту', process.env.PORT || 3000);
});

