import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());
app.get("/", (req, res) => {
  res.send("Dispatch system running");
});

app.get("/db-test", async (req, res) => {
  res.json({
    ok: true,
    message: "db-test route exists"
  });
});
// ======================
// 📦 基本設定
// ======================
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const TG_GROUP_ID = "-5141789828";

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const BASE_URL = "https://line-dispatch.onrender.com";

/** 版主設定（V1 寫死；日後可改後台） */
const allowAnyMinute = false;
const bufferMinutes = 5;
const waitingFeePerMinute = 5;
const cancelFee = 100;

let orders = {};
let orderCounter = 100;

function isBotTagged(text) {
  const lower = text.toLowerCase();
  if (lower.includes("@taxi_dispatch_bot")) return true;
  if (text.includes("@派單機器人")) return true;
  return false;
}

function stripBotTags(text) {
  return text
    .replace(/@taxi_dispatch_bot/gi, "")
    .replace(/@派單機器人/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function logStatusChange(oldStatus, newStatus) {
  if (oldStatus !== newStatus) {
    console.log("訂單狀態改變", oldStatus, "=>", newStatus);
  }
}

function createOrderRecord(id, rawText, customerLineId) {
  const now = new Date().toISOString();
  return {
    id,
    rawText,
    customerLineId,
    status: "bidding",
    createdAt: now,

    bids: [],

    selectedDriverId: null,
    selectedDriverName: null,
    selectedDriverUsername: null,
    selectedKeyword: null,
    selectedEta: null,
    selectedAt: null,

    departAt: null,
    arrivedAt: null,
    onboardAt: null,
    completedAt: null,

    mileage: null,
    fare: null,
    waitingMinutes: null,

    bufferMinutes,
    waitingFeePerMinute,
    bidAt: null,
    waitingStartAt: null,

    cancelFeeRequired: false,
    cancelFee
  };
}

/** 依序套用每筆 bid，得到目前應有的領先 bid（符合白牌順位規則） */
function computeLeadingBid(bids) {
  if (!bids.length) return null;
  let leading = bids[0];
  for (let i = 1; i < bids.length; i++) {
    const b = bids[i];
    if (leading.eta <= 10) {
      continue;
    }
    if (b.eta <= 10) {
      leading = b;
    }
  }
  return leading;
}

function leadingBidChanged(prev, next) {
  if (!prev && !next) return false;
  if (!prev || !next) return true;
  return (
    prev.driverId !== next.driverId ||
    prev.bidAt !== next.bidAt ||
    prev.eta !== next.eta ||
    prev.keyword !== next.keyword
  );
}

function setWaitingSchedule(order, bid) {
  order.bidAt = bid.bidAt;
  order.bufferMinutes = bufferMinutes;
  order.waitingFeePerMinute = waitingFeePerMinute;
  const base = new Date(bid.bidAt).getTime();
  order.waitingStartAt = new Date(base + (bid.eta + order.bufferMinutes) * 60_000).toISOString();
}

async function applySelectionFromLeading(order, leading, chatId, messageId) {
  const oldStatus = order.status;
  order.selectedDriverId = leading.driverId;
  order.selectedDriverName = leading.driverName;
  order.selectedDriverUsername = leading.driverUsername;
  order.selectedKeyword = leading.keyword;
  order.selectedEta = leading.eta;
  order.selectedAt = new Date().toISOString();
  setWaitingSchedule(order, leading);

  order.status = "pending_confirm";
  order.cancelFeeRequired = false;

  logStatusChange(oldStatus, order.status);
  console.log("目前候選司機", order.selectedDriverName);

  const tag =
    order.selectedDriverUsername != null && order.selectedDriverUsername !== ""
      ? `@${order.selectedDriverUsername}`
      : order.selectedDriverName;

  await tgSend(
    chatId,
    `✅ 訂單 #${order.id} 暫派給 ${tag}\n請 ${tag} 回tag本機器人確認`,
    messageId
  );
}

/**
 * 取得最新一筆 bidding 訂單（建立時間最大者）
 * TODO: 多筆 bidding 時依路名/疊單模板匹配；同路名多單須完整路名+號碼
 */
function getLatestBiddingOrder() {
  let latest = null;
  let latestMs = -Infinity;
  for (const id of Object.keys(orders)) {
    const o = orders[id];
    if (o.status !== "bidding") continue;
    const t = new Date(o.createdAt).getTime();
    if (t >= latestMs) {
      latestMs = t;
      latest = o;
    }
  }
  return latest;
}

function parseBidPayload(body) {
  const m = body.match(/^(.+?)(\d+)\s*$/);
  if (!m) return { ok: false, reason: "format" };
  const keyword = m[1].trim();
  const eta = parseInt(m[2], 10);
  if (!keyword || Number.isNaN(eta)) return { ok: false, reason: "format" };
  if (!allowAnyMinute && eta % 5 !== 0) return { ok: false, reason: "minute" };
  return { ok: true, keyword, eta };
}

function parseCompletePayload(body) {
  const trimmed = body.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 3) return null;
  const numRe = /^\d+(\.\d+)?$/;
  if (!parts.every((p) => numRe.test(p))) return null;

  const mileage = parts[0];
  const waitingMinutes = parseInt(parts[1], 10);
  const fare = parts[2];

  if (Number.isNaN(waitingMinutes)) return null;
  return { mileage, waitingMinutes, fare };
}

function findActiveOrderForDriver(driverId) {
  for (const id of Object.keys(orders)) {
    const o = orders[id];
    if (o.selectedDriverId !== driverId) continue;
    if (["pending_confirm", "assigned", "arrived", "onboard"].includes(o.status)) return o;
  }
  return null;
}

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
// 🔥 LINE Push（🔥有log）
// ======================
async function linePush(userId, messages) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
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

  const text = await res.text();
  console.log("📨 LINE PUSH回應:", text);
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

    const rawText = event.message.text.trim();
    const userId = event.source.userId;

    console.log("📱 LINE收到:", rawText);

    orderCounter++;
    const orderId = String(orderCounter);

    const order = createOrderRecord(orderId, rawText, userId);
    orders[orderId] = order;
    console.log("訂單建立", order);

    await lineReply(event.replyToken, [
      {
        type: "text",
        text:
          `🚗 訂單成立\n` +
          `📍 ${rawText}\n\n` +
          `👉 查看狀態：\n${BASE_URL}/order/${orderId}`
      }
    ]);

    await tgSend(
      TG_GROUP_ID,
      `🚕 新訂單 #${orderId}\n\n${rawText}`
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
  const firstName = msg.from?.first_name || "司機";
  const username = msg.from?.username || null;
  const messageId = msg.message_id;

  console.log("📩 TG收到:", text);

  if (!isBotTagged(text)) return res.sendStatus(200);

  const body = stripBotTags(text);

  const orderForDriver = userId != null ? findActiveOrderForDriver(userId) : null;

  const parsedComplete = parseCompletePayload(body);
  if (orderForDriver && parsedComplete && orderForDriver.status === "onboard") {
    const oldStatus = orderForDriver.status;
    orderForDriver.mileage = parsedComplete.mileage;
    orderForDriver.fare = parsedComplete.fare;
    orderForDriver.waitingMinutes = parsedComplete.waitingMinutes;
    orderForDriver.status = "completed";
    orderForDriver.completedAt = new Date().toISOString();
    logStatusChange(oldStatus, orderForDriver.status);
    await tgSend(
      chatId,
      `✅ 訂單 #${orderForDriver.id} 已完成\n里程：${orderForDriver.mileage}\n金額：${orderForDriver.fare}\n等待：${orderForDriver.waitingMinutes}分鐘`,
      messageId
    );
    return res.sendStatus(200);
  }

  if (orderForDriver && /客上|客人上車|⬆️/.test(body) && ["arrived", "assigned"].includes(orderForDriver.status)) {
    const oldStatus = orderForDriver.status;
    orderForDriver.status = "onboard";
    orderForDriver.onboardAt = new Date().toISOString();
    logStatusChange(oldStatus, orderForDriver.status);
    await tgSend(chatId, `⬆️ 訂單 #${orderForDriver.id} 客人已上車`, messageId);
    return res.sendStatus(200);
  }

  if (orderForDriver && /到\s*$/.test(body) && orderForDriver.status === "assigned") {
    const oldStatus = orderForDriver.status;
    orderForDriver.status = "arrived";
    orderForDriver.arrivedAt = new Date().toISOString();
    logStatusChange(oldStatus, orderForDriver.status);
    await tgSend(chatId, `📍 訂單 #${orderForDriver.id} 司機已到點`, messageId);
    return res.sendStatus(200);
  }

  if (
    orderForDriver &&
    orderForDriver.status === "pending_confirm" &&
    orderForDriver.selectedDriverId === userId
  ) {
    const oldStatus = orderForDriver.status;
    orderForDriver.status = "assigned";
    orderForDriver.departAt = new Date().toISOString();
    logStatusChange(oldStatus, orderForDriver.status);
    const tag = username ? `@${username}` : firstName;
    await tgSend(chatId, `🚗 ${tag} 已確認出發，訂單 #${orderForDriver.id}`, messageId);

    await linePush(orderForDriver.customerLineId, [
      {
        type: "text",
        text:
          `🚗 司機已確認出發\n\n` +
          `👤 ${orderForDriver.selectedDriverName}\n` +
          `⏱ 約 ${orderForDriver.selectedEta} 分鐘抵達\n\n` +
          `${BASE_URL}/order/${orderForDriver.id}`
      }
    ]);
    return res.sendStatus(200);
  }

  if (orderForDriver) {
    return res.sendStatus(200);
  }

  const bidOrder = getLatestBiddingOrder();
  if (!bidOrder) return res.sendStatus(200);

  const parsedBid = parseBidPayload(body);
  if (!parsedBid.ok) {
    const msgText =
      parsedBid.reason === "minute"
        ? `❌ 喊單時間須為 5 的倍數（目前 allowAnyMinute=false）`
        : `❌ 喊單格式錯誤，請輸入：路名+時間，例如 春日10`;
    await tgSend(chatId, msgText, messageId);
    return res.sendStatus(200);
  }

  const bid = {
    driverId: userId,
    driverName: firstName,
    driverUsername: username,
    keyword: parsedBid.keyword,
    eta: parsedBid.eta,
    bidAt: new Date().toISOString()
  };

  const prevLeading =
    bidOrder.bids.length > 0 ? computeLeadingBid(bidOrder.bids) : null;

  bidOrder.bids.push(bid);
  console.log("司機喊單", bid);

  const nextLeading = computeLeadingBid(bidOrder.bids);

  if (leadingBidChanged(prevLeading, nextLeading) && nextLeading) {
    await applySelectionFromLeading(bidOrder, nextLeading, chatId, messageId);
  }

  res.sendStatus(200);
});

// ======================
// 🔥 Web（客戶頁）
// ======================
app.get("/order/:id", (req, res) => {
  const order = orders[req.params.id];
  if (!order) return res.send("<h2>❌ 訂單不存在</h2>");

  const statusMap = {
    bidding: "⏳ 媒合中",
    pending_confirm: "🚕 已有司機候選，等待司機確認",
    assigned: "🚗 司機已確認出發",
    arrived: "📍 司機已到點",
    onboard: "⬆️ 客人已上車",
    completed: "✅ 訂單已完成",
    cancelled: "❌ 訂單已取消"
  };

  const status = statusMap[order.status] || order.status;

  const driverLine =
    order.selectedDriverName != null
      ? `<p>👤 ${order.selectedDriverName}${order.selectedDriverUsername ? ` (@${order.selectedDriverUsername})` : ""}</p>`
      : "";

  const etaLine =
    order.selectedEta != null ? `<p>⏱ ETA：${order.selectedEta} 分鐘</p>` : "";

  const times = `
    <p>🕐 到點：${order.arrivedAt || "—"}</p>
    <p>🕐 上車：${order.onboardAt || "—"}</p>
    <p>🕐 完成：${order.completedAt || "—"}</p>
  `;

  const fareBlock =
    order.status === "completed"
      ? `
    <p>💰 金額：${order.fare ?? "—"}</p>
    <p>📏 里程：${order.mileage ?? "—"}</p>
    <p>⏳ 等待：${order.waitingMinutes != null ? `${order.waitingMinutes} 分鐘` : "—"}</p>
  `
      : "";

  const cancelBlock =
    order.cancelFeeRequired === true
      ? `<p>⚠️ 取消可能需付費：${order.cancelFee ?? cancelFee}</p>`
      : "";

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
      <h2>🚗 訂單 ${req.params.id}</h2>
      <p>📍 ${order.rawText}</p>
      <p>${status}</p>
      ${driverLine}
      ${etaLine}
      ${times}
      ${fareBlock}
      ${cancelBlock}
    </div>
  </body>
  </html>
  `);
});

app.listen(10000, () => {
  console.log("🚀 Server running on port 10000");
});
