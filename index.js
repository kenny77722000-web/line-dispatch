import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

let orders = {};
let orderCounter = 100;

// 👉 換成你的群組ID
const DRIVER_GROUP_ID = "你的groupId";

// 🔥 推播訊息（給群組）
async function push(to, messages) {
  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      to,
      messages
    })
  });
}

// 🔥 回覆用戶
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
    // 🚕 司機搶單（群組）
    // ======================
    if (event.source.type === "group" && /^\d+$/.test(text)) {
      const orderId = text;

      if (!orders[orderId]) {
        await reply(event.replyToken, [{ type: "text", text: "❌ 訂單不存在" }]);
        continue;
      }

      if (orders[orderId].driver) {
        await reply(event.replyToken, [{ type: "text", text: "❌ 已被搶走" }]);
        continue;
      }

      orders[orderId].driver = userId;

      await reply(event.replyToken, [
        { type: "text", text: `✅ 搶單成功！訂單 ${orderId}` }
      ]);

      continue;
    }

    // ======================
    // 🧾 客戶建立訂單（私訊）
    // ======================
    if (event.source.type === "user") {
      orderCounter++;
      const orderId = orderCounter.toString();

      orders[orderId] = {
        text,
        driver: null
      };

      // 👉 回客戶
      await reply(event.replyToken, [
        {
          type: "text",
          text:
            `🚗 訂單建立成功\n` +
            `📍 ${text}\n` +
            `🆔 訂單編號：${orderId}`
        }
      ]);

      // 👉 推送到司機群
      await push(DRIVER_GROUP_ID, [
        {
          type: "text",
          text:
            `🚨 新訂單 🚨\n` +
            `📍 ${text}\n\n` +
            `👉 請輸入 ${orderId} 搶單`
        }
      ]);

      console.log("派單到群:", orderId);
    }
  }

  res.sendStatus(200);
});

app.listen(10000, () => {
  console.log("Server running on port 10000");
});
