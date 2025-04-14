require("dotenv").config();
const twilio = require("twilio");
const axios = require("axios");

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

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

    // Получение списка партнёров
    console.log("📥 Получение списка партнёров...");
    const partnersResponse = await axios.get(
      "https://lk.peptides1.ru/api/dealers/231253/partners?with_side_volume=true&limit=1000&offset=0",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const partners = partnersResponse.data;
    console.log(`👥 Получено партнёров: ${partners.length}`);

    const normalizePhone = (phone) => phone?.replace(/\D/g, "") || "";

    for (const partner of partners) {
      const phone = normalizePhone(partner.partner?.person?.phone);
      const balance = partner.account_balance || 0;

      if (!phone || balance < 1000) continue;

      const fullName = `${partner.partner?.person?.first_name || "Без имени"} ${partner.partner?.person?.middle_name || ""}`.trim();
      const toNumber = `whatsapp:+${phone}`;

      console.log(`📨 Отправка сообщения на ${toNumber} (${fullName})...`);

      try {
        await client.messages.create({
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: toNumber,
          contentSid: process.env.BONUS_TEMPLATE_SID,
          contentVariables: JSON.stringify({
            "1": fullName,
            "2": balance.toString()
          }),
        });

        console.log(`✅ Сообщение отправлено на ${toNumber}, баланс: ${balance}`);
      } catch (err) {
        console.error(`❌ Ошибка при отправке на ${toNumber}:`, err.message);
      }
    }
  } catch (error) {
    console.error("❌ Ошибка при выполнении рассылки:", error.message);
  }
};

sendTestNewsletter();
