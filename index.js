} else if (session.step === "waiting_for_password") {
  session.password = message;
  session.step = "done";

  try {
    // Авторизация по новому API
    const authResponse = await axios.post(
      "https://lk.peptides1.ru/api/auth/sign-in",
      {
        login: session.login,
        password: session.password,
      }
    );

    const token = authResponse.data.token;

    // Получение баланса
    const userResponse = await axios.get(
      "https://lk.peptides1.ru/api/user/info",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const bonus = userResponse.data.current.balance[0].amount;

    await client.messages.create({
      from: waNumber,
      to: from,
      body: `🎉 Ваш бонусный баланс: ${bonus} ₽`,
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
}
