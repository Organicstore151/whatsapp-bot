require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const { MessagingResponse } = require("twilio").twiml;
const { Twilio } = require("twilio");

const app = express();
const client = new Twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
const waNumber = process.env.WHATSAPP_NUMBER;

app.use(bodyParser.urlencoded({ extended: false }));

app.post("/incoming", async (req, res) => {
  const from = req.body.From;
  const message = req.body.Body?.trim();

  try {
    if (message === "Каталог препаратов") {
      await client.messages.create({
        from: waNumber,
        to: from,
        contentSid: process.env.TEMPLATE_SID_CATALOG,
        contentVariables: JSON.stringify({
          // Если у шаблона есть переменные — подставь их сюда
          // Пример:
          // title: "Каталог препаратов",
          // body: "Выберите интересующие вас товары",
        }),
      });

      return res.sendStatus(200);
    }

    // Остальные команды
    const twiml = new MessagingResponse();
    const msg = twiml.message("Выберите команду из меню:");
    msg.button({
      body: "Меню команд",
      action: {
        buttons: [
          { type: "reply", reply: { id: "balance", title: "Узнать баланс бонусов" } },
          { type: "reply", reply: { id: "catalog", title: "Каталог препаратов" } },
        ],
      },
    });
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(twiml.toString());
  } catch (error) {
    console.error("Ошибка при обработке запроса:", error);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
