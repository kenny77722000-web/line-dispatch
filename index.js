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
// 🔥 LINE Push（通知）
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
// 🔥 TG 發送
// ======================
async function tgSend(chatId, text, replyId = null) {
  const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_to_message_id: replyId || undefined
    })
  });

  const data = await res.json();
  console.log("📨 TG回應:", data);
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

    console.log("📱 LINE收到:", text);

    orderCounter++;
    const orderId = orderCounter.toString();

    orders[orderId] = {
      text,
      driver: null,
      status: "pending",
      customerId: userId,
      eta: null
    };

    // 回LINE
    await lineReply(event.replyToken, [
      {
        type: "text",
        text:
          `🚗 訂單成立\n` +
          `📍 ${text}\n\n` +
          `👉 查看狀態：\n${BASE_URL}/order/${orderId}`
      }
    ]);

    // 推TG
    await tgSend(
      TG_GROUP_ID,
      `🚨 新訂單 🚨\n📍 ${text}\n👉 輸入：${orderId} 10（分鐘）搶單`
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
  const messageId = msg.message_id;

  console.log("📩 TG收到:", text);

  // 👉 支援：101 10
  const parts = text.split(" ");
  const orderId = parts[0];
  const eta = parts[1];

  if (!/^\d+$/.test(orderId)) return res.sendStatus(200);

  if (!orders[orderId]) {
    await tgSend(chatId, `❌ 訂單不存在 ${orderId}`, messageId);
    return res.sendStatus(200);
  }

  if (orders[orderId].driver) {
    await tgSend(chatId, `❌ 已被搶走 ${orderId}`, messageId);
    return res.sendStatus(200);
  }

  // 🔥 車卡
  const carPlate = "ABC-1234";
  const phone = "0912345678";

  orders[orderId].driver = userId;
  orders[orderId].status = "assigned";
  orders[orderId].driverName = name;
  orders[orderId].carPlate = carPlate;
  orders[orderId].phone = phone;
  orders[orderId].eta = eta || 10;

  // TG回覆
  await tgSend(
    chatId,
    `✅ 搶單成功\n訂單 ${orderId}\n⏱ ETA：${orders[orderId].eta} 分鐘`,
    messageId
  );

  // 🔥 LINE通知客戶（重點）
  await linePush(orders[orderId].customerId, [
    {
      type: "text",
      text:
        `🚗 司機已接單\n\n` +
        `👤 ${name}\n` +
        `🚗 ${carPlate}\n` +
        `📞 ${phone}\n\n` +
        `⏱ ${orders[orderId].eta} 分鐘抵達\n\n` +
        `${BASE_URL}/order/${orderId}`
    }
  ]);

  // 🔥 ETA倒數
  setInterval(() => {
    if (orders[orderId] && orders[orderId].eta > 0) {
      orders[orderId].eta--;
    }
  }, 60000);

  res.sendStatus(200);
});

// ======================
// 🔥 Web（美化版）
// ======================
app.get("/order/:id", (req, res) => {
  const orderId = req.params.id;
  const order = orders[orderId];

  if (!order) return res.send("<h2>❌ 訂單不存在</h2>");

  let status = "⏳ 媒合中...";
  let extra = "";

  if (order.status === "assigned") {
    status = "🚗 已有司機接單";
    extra = `
      <p>🚗 ${order.carPlate}</p>
      <p>👤 ${order.driverName}</p>
      <p>📞 ${order.phone}</p>
      <p style="color:red;">⏱ ${order.eta} 分鐘</p>
    `;
  }

  res.send(`
  <html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="5">
    <style>
      body{font-family:sans-serif;background:#f5f5f5;padding:20px;}
      .card{background:#fff;padding:20px;border-radius:12px;box-shadow:0 5px 20px rgba(0,0,0,0.1);}
    </style>
  </head>

  <body>
    <div class="card">
      <h2>🚗 訂單 ${orderId}</h2>
      <p>📍 ${order.text}</p>
      <p>${status}</p>
      ${extra}
    </div>
  </body>
  </html>
  `);
});

app.listen(10000, () => {
  console.log("🚀 Server running on port 10000");
});
