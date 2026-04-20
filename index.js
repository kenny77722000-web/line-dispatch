import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ======================
// 📦 基本設定
// ======================
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN; // 👉 記得設環境變數
const TG_GROUP_ID = process.env.TG_GROUP_ID;   // 👉 群組ID（-100開頭）

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
async function tgSend(text) {
  await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TG_GROUP_ID,
      text
    })
  });
}

// ======================
// 🔥 LINE Webhook（客戶用）
// ======================
app.post("/line/webhook", async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") continue;

    const text = event.message.text.trim();

    console.log("LINE收到:", text);

    // 🧾 建立訂單
    orderCounter++;
    const orderId = orderCounter.toString();

    orders[orderId] = {
      text,
      driver: null
    };

    // 👉 回客戶
    await lineReply(event.replyToken, [
      {
        type: "text",
        text:
          `🚗 訂單成立\n` +
          `📍 ${text}\n` +
          `🆔 ${orderId}`
      }
    ]);

    // 👉 推到 TG 群
    await tgSend(
      `🚨 新訂單 🚨\n` +
      `📍 ${text}\n\n` +
      `👉 輸入 ${orderId} 搶單`
    );

    console.log("派單到TG:", orderId);
  }

  res.sendStatus(200);
});

// ======================
// 🔥 TG Webhook（司機用）
// ======================
app.post("/tg/webhook", async (req, res) => {
  const msg = req.body.message;
  if (!msg || !msg.text) return res.sendStatus(200);

  const text = msg.text.trim();
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  console.log("TG收到:", text);

  // 👉 只處理群組
  if (chatId != TG_GROUP_ID) return res.sendStatus(200);

  // 🚕 搶單
  if (/^\d+$/.test(text)) {
    const orderId = text;

    if (!orders[orderId]) {
      await tgSend(`❌ 訂單不存在 ${orderId}`);
      return res.sendStatus(200);
    }

    if (orders[orderId].driver) {
      await tgSend(`❌ 已被搶走 ${orderId}`);
      return res.sendStatus(200);
    }

    orders[orderId].driver = userId;

    await tgSend(`✅ 搶單成功！訂單 ${orderId}`);

    console.log("TG搶單成功:", orderId);
  }

  res.sendStatus(200);
});

// ======================
// 🚀 啟動
// ======================
app.listen(10000, () => {
  console.log("Server running on port 10000");
});
