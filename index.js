const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const axios = require("axios");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Хранилище сессий пользователей
const sessions = {};

app.post("/webhook", async (req, res) => {
  const from = req.body.From;
  const message = req.body.Body.trim();
  const waNumber = req.body.To;

  if (!sessions[from]) {
    await client.messages.create({
      from: waNumber,
      to: from,
      contentSid: process.env.TEMPLATE_SID,
    });
    sessions[from] = { step: "waiting_for_command" };
    return res.status(200).send();
  }

  const session = sessions[from];

  if (session.step === "waiting_for_command") {
    if (message === "Узнать баланс бонусов") {
      await client.messages.create({
        from: waNumber,
        to: from,
        body: "Пожалуйста, отправьте ваш ID (логин):",
      });
      session.step = "waiting_for_login";
    }

    // Новый шаблон с вариантами каталога
    if (message === "Информация о продукции") {
      try {
        await client.messages.create({
          from: waNumber,
          to: from,
          contentSid: "HXc07f9a56c952dd93c5a4308883e00a7e", // catalog_options_new
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

    // Отправка PDF-файлов по выбранной опции
    if (message === "Каталог препаратов") {
      await sendPDF(
        waNumber,
        from,
        "🧾 Ознакомьтесь с нашим каталогом препаратов📥",
        "https://organicstore151.github.io/whatsapp-catalog/catalog.pdf"
      );
    }

    if (message === "Курс лечения") {
      await sendPDF(
        waNumber,
        from,
        "🩺 Ознакомьтесь с рекомендациями по комплексному применению📥",
        "https://organicstore151.github.io/comples/complex.pdf"
      );
    }

    if (message === "Прайс-лист") {
      await sendPDF(
        waNumber,
        from,
        "💰 Ознакомьтесь с актуальным прайс-листом📥",
        "https://organicstore151.github.io/price/price.pdf"
      );
    }
  }

  // Авторизация
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

  return res.status(200).send();
});

// Функция отправки PDF
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

const sendTestNewsletter = async () => {
  try {
    console.log("🚀 Запуск sendTestNewsletter...");

    // Авторизация
    console.log("🔐 Авторизация...");
    const authResponse = await axios.post("https://lk.peptides1.ru/api/auth/sign-in", {
      login: process.env.LOGIN,
      password: process.env.PASSWORD,
    });

    const token = authResponse.data.token;
    console.log("✅ Авторизация успешна");

    // Получение клиентов
    console.log("📥 Получение списка партнёров...");
    const partnersResponse = await axios.get(
      "https://lk.peptides1.ru/api/dealers/231253/partners?with_side_volume=true&limit=100&offset=0",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const partners = partnersResponse.data;
    console.log("🔎 Пример партнёра:", JSON.stringify(partners[0], null, 2));
    console.log(`👥 Получено партнёров: ${partners.length}`);

    const normalizePhone = (phone) => phone?.replace(/\D/g, "") || "";

    const targetPhone = "77772004488"; // Этот номер для отправки

    console.log("📋 Проверка номеров в базе:");
    for (const p of partners) {
      const phone = p.partner?.person?.phone; // Теперь доступ к номеру по правильному пути
      const firstName = p.partner?.person?.first_name || "Без имени";
      console.log("-", normalizePhone(phone), firstName);
    }

    // Ищем партнёра по номеру
    const target = partners.find((p) =>
      normalizePhone(p.partner?.person?.phone).endsWith("77772004488")
    );

    if (target) {
      const balance = target.account_balance;

      // Проверяем, что first_name и middle_name существуют
      const firstName = target.partner?.person?.first_name || "Без имени";
      const middleName = target.partner?.person?.middle_name || ""; // если middle_name отсутствует, будет пустая строка

      if (typeof firstName === "undefined" || typeof middleName === "undefined") {
        throw new Error("Имя или фамилия пользователя не найдены");
      }

      const fullName = `${firstName} ${middleName}`.trim(); // Применяем trim только к строкам
      const toNumber = `whatsapp:+${normalizePhone(target.partner?.person?.phone)}`;

      // Проверка значений перед отправкой
      if (!fullName || !balance) {
        throw new Error("Не все необходимые данные (имя или баланс) найдены для отправки сообщения.");
      }

      console.log(`📨 Отправка сообщения на ${toNumber} (${fullName})...`);

      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: toNumber,
        template: 'HX46fd99955fd4978b7b652b5f018b18d2',  // SID шаблона
        templateData: {
          '1': fullName,  // Имя пользователя
          '2': balance,   // Баланс
        },
      });

      console.log(`✅ Сообщение отправлено на ${toNumber} (${fullName}), баланс: ${balance}`);
    } else {
      console.log("❌ Пользователь с таким номером не найден.");
    }
  } catch (error) {
    console.error("❌ Ошибка при отправке тестовой рассылки:", error.message);
  }
};

sendTestNewsletter();
