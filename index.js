
if (session.step === "waiting_for_command") {
  if (message === "Узнать баланс бонусов") {
    await client.messages.create({
      from: waNumber,
      to: from,
      body: "Пожалуйста, отправьте ваш ID (логин):",
    });
    session.step = "waiting_for_login";
  }

  if (message === "Информация о продукции") {
    try {
      await client.messages.create({
        from: waNumber,
        to: from,
        contentSid: "HXc07f9a56c952dd93c5a4308883e00a7e",
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

  // 🛒 ЗАКАЗ: старт
  if (message === "Сделать заказ") {
    session.step = "order_waiting_for_name";
    await client.messages.create({
      from: waNumber,
      to: from,
      body: "📝 Пожалуйста, укажите ваше ФИО:",
    });
  }
}

// 🛒 ЗАКАЗ: шаг 1 — ФИО
else if (session.step === "order_waiting_for_name") {
  session.orderName = message;
  session.step = "order_waiting_for_items";
  await client.messages.create({
    from: waNumber,
    to: from,
    body: "📦 Укажите, что вы хотите заказать (название препарата и количество):",
  });
}

// 🛒 ЗАКАЗ: шаг 2 — товары
else if (session.step === "order_waiting_for_items") {
  session.orderItems = message;
  session.step = "order_waiting_for_address";
  await client.messages.create({
    from: waNumber,
    to: from,
    body: "🏠 Укажите, пожалуйста, адрес доставки:",
  });
}

// 🛒 ЗАКАЗ: шаг 3 — адрес
else if (session.step === "order_waiting_for_address") {
  session.orderAddress = message;
  session.step = "done";

  // Отправка подтверждения
  const summary = `✅ Спасибо за ваш заказ!\n\n👤 ФИО: ${session.orderName}\n📦 Заказ: ${session.orderItems}\n🏠 Адрес: ${session.orderAddress}\n\nМы скоро свяжемся с вами для подтверждения.`;

  await client.messages.create({
    from: waNumber,
    to: from,
    body: summary,
  });

  // Можно отправить данные админу, в Telegram, в Google Sheets и т.п.

  delete sessions[from]; // очищаем сессию
}
