import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ======================
// 📦 基本設定
// ======================
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const TG_GROUP_ID = "-5141789828"; // 你的TG群

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const BASE_URL = "https://你的網址.onrender.com"; // 🔥 換成你的

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
// 🔥 TG 發訊息
// ======================
async function tgSend(chatId, text, replyId = null) {
  console.log("📤 TG送出:", chatId, text);

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
// 🔥 LINE Webhook（客戶）
// ======================
app.post("/line/webhook", async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") continue;

    const text = event.message.text.trim();
    console.log("📱 LINE收到:", text);

    // 建立訂單
    orderCounter++;
    const orderId = orderCounter.toString();

    orders[orderId] = {
      text,
      driver: null,
      status: "pending"
    };

    // 🔥 回客戶（含訂單頁）
    await lineReply(event.replyToken, [
      {
        type: "text",
        text:
          `🚗 訂單成立\n` +
          `📍 ${text}\n\n` +
          `👉 查看狀態：\n` +
          `${BASE_URL}/order/${orderId}`
      }
    ]);

    // 🔥 派到TG
    await tgSend(
      TG_GROUP_ID,
      `🚨 新訂單 🚨\n📍 ${text}\n👉 輸入 ${orderId} 搶單`
    );

    console.log("✅ 派單到TG:", orderId);
  }

  res.sendStatus(200);
});

// ======================
// 🔥 TG Webhook（司機）
// ======================
app.post("/tg/webhook", async (req, res) => {
  const msg = req.body.message;
  if (!msg || !msg.text) return res.sendStatus(200);

  const text = msg.text.trim();
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const messageId = msg.message_id;

  console.log("📩 TG收到:", text);

  // ======================
  // 🚕 搶單
  // ======================
  if (/^\d+$/.test(text)) {
    const orderId = text;

    if (!orders[orderId]) {
      await tgSend(chatId, `❌ 訂單不存在 ${orderId}`, messageId);
      return res.sendStatus(200);
    }

    if (orders[orderId].driver) {
      await tgSend(chatId, `❌ 已被搶走 ${orderId}`, messageId);
      return res.sendStatus(200);
    }

    orders[orderId].driver = userId;
    orders[orderId].status = "assigned";

    await tgSend(chatId, `✅ 搶單成功！訂單 ${orderId}`, messageId);

    console.log("🎉 TG搶單成功:", orderId);
  }

  res.sendStatus(200);
});

// ======================
// 📄 訂單狀態頁（客戶看）
// ======================
app.get("/order/:id", (req, res) => {
  const orderId = req.params.id;
  const order = orders[orderId];

  if (!order) {
    return res.send("<h2>❌ 訂單不存在</h2>");
  }

  let statusText = "⏳ 媒合中...";
  if (order.status === "assigned") statusText = "🚗 已有司機接單";

  res.send(`
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="refresh" content="5">
      </head>
      <body style="font-family:sans-serif;padding:20px;">
        <h2>🚗 訂單 ${orderId}</h2>
        <p>📍 ${order.text}</p>
        <p>${statusText}</p>
      </body>
    </html>
  `);
});

// ======================
// 🚀 啟動
// ======================
app.listen(10000, () => {
  console.log("🚀 Server running on port 10000");
});
