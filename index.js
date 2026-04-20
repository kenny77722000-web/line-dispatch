import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ======================
// 📦 基本設定
// ======================
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;

// ✅ 🔥 直接寫死（用你抓到的）
const TG_GROUP_ID = "-5141789828";

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

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
      driver: null
    };

    // 回客戶
    await lineReply(event.replyToken, [
      {
        type: "text",
        text:
          `🚗 訂單成立\n` +
          `📍 ${text}\n` +
          `🆔 ${orderId}`
      }
    ]);

    // 🔥 一定派到TG（不再判斷）
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
  console.log("👉 chatId:", chatId);

  // ❌ 不再限制群組（避免你被擋）
  // if (String(chatId) !== TG_GROUP_ID) return;

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

    await tgSend(chatId, `✅ 搶單成功！訂單 ${orderId}`, messageId);

    console.log("🎉 TG搶單成功:", orderId);
  }

  res.sendStatus(200);
});

// ======================
// 🚀 啟動
// ======================
app.listen(10000, () => {
  console.log("🚀 Server running on port 10000");
});
