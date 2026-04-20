import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ======================
// 📦 基本設定
// ======================
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const TG_GROUP_ID = "-5141789828";

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const BASE_URL = "https://line-dispatch.onrender.com";

let orders = {};
let orderCounter = 100;

// 🔥 司機資料庫
let drivers = {};
let lastRegisterUser = null;

// ======================
// 🔥 LINE Reply
// ======================
async function lineReply(token, messages) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_TOKEN}`
    },
    body: JSON.stringify({
      replyToken: token,
      messages
    })
  });
}

// ======================
async function linePush(userId, messages) {
  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_TOKEN}`
    },
    body: JSON.stringify({
      to: userId,
      messages
    })
  });
}

// ======================
async function tgSend(chatId, text, replyId = null) {
  await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_to_message_id: replyId || undefined
    })
  });
}

// ======================
// 🔥 LINE（客戶）
// ======================
app.post("/line/webhook", async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") continue;

    const text = event.message.text.trim();
    const userId = event.source.userId;

    orderCounter++;
    const orderId = orderCounter.toString();

    orders[orderId] = {
      text,
      driver: null,
      status: "pending",
      customerId: userId,
      eta: null
    };

    await lineReply(event.replyToken, [
      {
        type: "text",
        text:
          `🚗 訂單成立\n` +
          `📍 ${text}\n\n` +
          `👉 查看狀態：\n${BASE_URL}/order/${orderId}`
      }
    ]);

    await tgSend(
      TG_GROUP_ID,
      `🚨 新訂單 🚨\n📍 ${text}\n👉 輸入：${orderId} 10`
    );
  }

  res.sendStatus(200);
});

// ======================
// 🔥 TG（司機）
// ======================
app.post("/tg/webhook", async (req, res) => {
  const msg = req.body.message;
  if (!msg || !msg.text) return res.sendStatus(200);

  const text = msg.text.trim();
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const name = msg.from?.first_name || "司機";

  console.log("📩 TG:", text);
  console.log("👉 userId:", userId);

  // ======================
  // 🔥 註冊
  // ======================
  if (text.startsWith("/register")) {
    const parts = text.split(" ");
    const carPlate = parts[1];
    const phone = parts[2];

    drivers[userId] = {
      name,
      carPlate,
      phone,
      active: false
    };

    lastRegisterUser = userId;

    await tgSend(
      chatId,
      `📝 註冊成功（待審核）\n\n👤 ${name}\n🚗 ${carPlate}\n📞 ${phone}\n🆔 ${userId}`
    );

    return res.sendStatus(200);
  }

  // ======================
  // 🔥 查看司機
  // ======================
  if (text === "/drivers") {
    let list = "🚗 司機列表\n\n";

    for (let id in drivers) {
      const d = drivers[id];
      list += `${d.name} | ${d.carPlate} | ${d.active ? "✅" : "❌"}\nID:${id}\n\n`;
    }

    await tgSend(chatId, list || "沒有司機");
    return res.sendStatus(200);
  }

  // ======================
  // 🔥 審核（免打ID）
  // ======================
  if (text === "/approve") {
    if (!lastRegisterUser) {
      await tgSend(chatId, "❌ 沒有待審核");
      return res.sendStatus(200);
    }

    drivers[lastRegisterUser].active = true;

    await tgSend(
      chatId,
      `✅ 已核准\n👤 ${drivers[lastRegisterUser].name}`
    );

    return res.sendStatus(200);
  }

  // ======================
  // 🔥 指定審核
  // ======================
  if (text.startsWith("/approve ")) {
    const id = text.split(" ")[1];

    if (drivers[id]) {
      drivers[id].active = true;
      await tgSend(chatId, `✅ 已核准 ${drivers[id].name}`);
    } else {
      await tgSend(chatId, "❌ 找不到司機");
    }

    return res.sendStatus(200);
  }

  // ======================
  // 🚕 搶單
  // ======================
  const parts = text.split(" ");
  const orderId = parts[0];
  const eta = parts[1];

  if (!/^\d+$/.test(orderId)) return res.sendStatus(200);

  const driver = drivers[userId];

  if (!driver || !driver.active) {
    await tgSend(chatId, "❌ 未授權司機（先 /register）");
    return res.sendStatus(200);
  }

  if (!orders[orderId]) {
    await tgSend(chatId, "❌ 訂單不存在");
    return res.sendStatus(200);
  }

  if (orders[orderId].driver) {
    await tgSend(chatId, "❌ 已被搶走");
    return res.sendStatus(200);
  }

  orders[orderId].driver = userId;
  orders[orderId].status = "assigned";
  orders[orderId].driverName = driver.name;
  orders[orderId].carPlate = driver.carPlate;
  orders[orderId].phone = driver.phone;
  orders[orderId].eta = Number(eta) || 10;

  await tgSend(chatId, `✅ 搶單成功 ${orderId}`);

  // 🔥 LINE 二次通知（關鍵）
  await linePush(orders[orderId].customerId, [
    {
      type: "text",
      text:
        `🚗 已接單\n\n` +
        `👤 ${driver.name}\n` +
        `🚗 ${driver.carPlate}\n` +
        `📞 ${driver.phone}\n\n` +
        `⏱ ${orders[orderId].eta} 分鐘\n\n` +
        `${BASE_URL}/order/${orderId}`
    }
  ]);

  res.sendStatus(200);
});

// ======================
// 🔥 Web
// ======================
app.get("/order/:id", (req, res) => {
  const order = orders[req.params.id];
  if (!order) return res.send("❌ 訂單不存在");

  let status = "⏳ 媒合中...";
  let extra = "";

  if (order.status === "assigned") {
    status = "🚗 已接單";
    extra = `
      <p>👤 ${order.driverName}</p>
      <p>🚗 ${order.carPlate}</p>
      <p>📞 ${order.phone}</p>
      <p>⏱ ${order.eta} 分鐘</p>
    `;
  }

  res.send(`
  <html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="5">
  </head>
  <body>
    <h2>🚗 訂單 ${req.params.id}</h2>
    <p>📍 ${order.text}</p>
    <p>${status}</p>
    ${extra}
  </body>
  </html>
  `);
});

app.listen(10000, () => {
  console.log("🚀 Server running on port 10000");
});
