import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ======================
// 📦 基本設定
// ======================
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
let TG_GROUP_ID = process.env.TG_GROUP_ID; // 👉 可自動覆蓋

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

    // 推送 TG
    if (!TG_GROUP_ID) {
      console.log("❌ 還沒抓到 TG 群組ID");
      continue;
    }

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
  console.log("🔥 TG RAW:", JSON.stringify(req.body, null, 2));

  const msg = req.body.message;
  if (!msg) return res.sendStatus(200);

  const text = msg.text || "";
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const messageId = msg.message_id;

  console.log("📩 TG收到:", text);
  console.log("👉 chatId:", chatId);
  console.log("👉 chat type:", msg.chat.type);

  // 🔥 自動抓群組ID（第一次）
  if (msg.chat.type === "group" || msg.chat.type === "supergroup") {
    TG_GROUP_ID = chatId;
    console.log("✅ 已記錄群組ID:", TG_GROUP_ID);
  }

  // 👉 還沒群組ID直接跳
  if (!TG_GROUP_ID) {
    console.log("❌ 尚未取得群組ID");
    return res.sendStatus(200);
  }

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
