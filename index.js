import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ======================
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const TG_GROUP_ID = "-5141789828";

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const BASE_URL = "https://line-dispatch.onrender.com";

const ADMIN_PASSWORD = "123456";

let orders = {};
let orderCounter = 100;
let drivers = {};
let lastRegisterUser = null;

// ======================
async function lineReply(token, messages) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_TOKEN}`
    },
    body: JSON.stringify({ replyToken: token, messages })
  });
}

async function linePush(userId, messages) {
  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_TOKEN}`
    },
    body: JSON.stringify({ to: userId, messages })
  });
}

async function tgSend(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

// ======================
// 🔥 LINE 客戶
// ======================
app.post("/line/webhook", async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type !== "message") continue;

    const text = event.message.text.trim();
    const userId = event.source.userId;

    orderCounter++;
    const orderId = orderCounter.toString();

    orders[orderId] = {
      text,
      status: "pending",
      customerId: userId
    };

    await lineReply(event.replyToken, [
      {
        type: "text",
        text:
          `🚗 訂單成立\n📍 ${text}\n\n👉 查看狀態：\n${BASE_URL}/order/${orderId}`
      }
    ]);

    await tgSend(
      TG_GROUP_ID,
      `🚨 新訂單 🚨\n📍 ${text}\n👉 ${orderId} 10`
    );
  }

  res.sendStatus(200);
});

// ======================
// 🔥 TG 司機
// ======================
app.post("/tg/webhook", async (req, res) => {
  const msg = req.body.message;
  if (!msg || !msg.text) return res.sendStatus(200);

  const text = msg.text.trim();
  const userId = msg.from.id;
  const name = msg.from.first_name;

  // 註冊
  if (text.startsWith("/register")) {
    const [_, carPlate, phone] = text.split(" ");

    drivers[userId] = {
      name,
      carPlate,
      phone,
      active: false
    };

    lastRegisterUser = userId;

    await tgSend(TG_GROUP_ID, `📝 新司機待審核\n${name}`);
    return res.sendStatus(200);
  }

  // 審核
  if (text === "/approve") {
    if (!lastRegisterUser) return;

    drivers[lastRegisterUser].active = true;
    await tgSend(TG_GROUP_ID, "✅ 已核准");
    return res.sendStatus(200);
  }

  // 搶單
  const [orderId, eta] = text.split(" ");
  const driver = drivers[userId];

  if (!driver || !driver.active) {
    await tgSend(TG_GROUP_ID, "❌ 未授權");
    return res.sendStatus(200);
  }

  const order = orders[orderId];
  if (!order || order.driver) return;

  order.driver = userId;
  order.status = "assigned";
  order.driverName = driver.name;
  order.carPlate = driver.carPlate;
  order.phone = driver.phone;
  order.eta = eta;

  await tgSend(TG_GROUP_ID, `✅ 接單成功 ${orderId}`);

  // LINE 通知
  await linePush(order.customerId, [
    {
      type: "text",
      text:
        `🚗 已接單\n👤 ${driver.name}\n🚗 ${driver.carPlate}\n📞 ${driver.phone}\n⏱ ${eta} 分鐘\n${BASE_URL}/order/${orderId}`
    }
  ]);

  res.sendStatus(200);
});

// ======================
// 🔥 訂單頁
// ======================
app.get("/order/:id", (req, res) => {
  const o = orders[req.params.id];
  if (!o) return res.send("❌");

  res.send(`
  <html>
  <head>
    <meta http-equiv="refresh" content="5">
  </head>
  <body style="font-family:sans-serif">
    <h2>訂單 ${req.params.id}</h2>
    <p>${o.text}</p>
    <p>${o.status}</p>
    ${o.driverName ? `<p>${o.driverName}</p>` : ""}
  </body>
  </html>
  `);
});

// ======================
// 🔥 後台 UI（完整）
// ======================
app.get("/admin/dashboard", (req, res) => {
  if (req.query.pwd !== ADMIN_PASSWORD) return res.send("❌");

  let driversUI = Object.entries(drivers).map(([id, d]) => `
    <div class="card">
      <b>${d.name}</b>
      <div>${d.carPlate}</div>
      <div>${d.phone}</div>
      <div>${d.active ? "✅" : "❌"}</div>
      <a href="/admin/approve?id=${id}&pwd=${ADMIN_PASSWORD}">核准</a>
      <a href="/admin/block?id=${id}&pwd=${ADMIN_PASSWORD}">封鎖</a>
    </div>
  `).join("");

  let ordersUI = Object.entries(orders).map(([id, o]) => `
    <div class="card">
      <b>訂單 ${id}</b>
      <div>${o.text}</div>
      <div>${o.status}</div>
      ${o.driverName ? `<div>${o.driverName}</div>` : ""}
    </div>
  `).join("");

  res.send(`
  <html>
  <style>
    body { background:#111;color:#fff;font-family:sans-serif }
    .card { background:#222;padding:10px;margin:10px;border-radius:8px }
  </style>
  <body>
    <h2>司機</h2>
    ${driversUI}
    <h2>訂單</h2>
    ${ordersUI}
  </body>
  </html>
  `);
});

app.listen(10000);
