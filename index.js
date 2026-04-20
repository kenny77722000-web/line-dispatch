import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// 🔥 訂單暫存（記憶體版）
let orders = {};
let orderCounter = 100;

// 🔥 回覆 LINE
async function reply(token, messages) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      replyToken: token,
      messages
    })
  });
}

app.post("/line/webhook", async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") continue;

    const text = event.message.text.trim();
    const userId = event.source.userId;

    console.log("收到:", text);

    // ======================
    // 🚕 司機搶單（純數字）
    // ======================
    if (/^\d+$/.test(text)) {
      const orderId = text;

      if (!orders[orderId]) {
        await reply(event.replyToken, [
          { type: "text", text: "❌ 訂單不存在" }
        ]);
        continue;
      }

      if (orders[orderId].driver) {
        await reply(event.replyToken, [
          { type: "text", text: "❌ 已被搶走" }
        ]);
        continue;
      }

      // 🔥 成功搶單
      orders[orderId].driver = userId;

      await reply(event.replyToken, [
        { type: "text", text: `✅ 搶單成功！訂單 ${orderId}` }
      ]);

      console.log("訂單被搶:", orderId);

      continue;
    }

    // ======================
    // 🧾 建立訂單（文字）
    // ======================
    orderCounter++;
    const orderId = orderCounter.toString();

    orders[orderId] = {
      text,
      driver: null
    };

    await reply(event.replyToken, [
      {
        type: "text",
        text:
          `🚗 訂單編號：${orderId}\n` +
          `📍 ${text}\n\n` +
          `👉 司機請輸入 ${orderId} 搶單`
      }
    ]);

    console.log("新訂單:", orderId);
  }

  res.sendStatus(200);
});

app.listen(10000, () => {
  console.log("Server running on port 10000");
});
