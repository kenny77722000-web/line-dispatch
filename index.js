import express from "express";

const app = express();
app.use(express.json());

// 測試首頁
app.get("/", (req, res) => {
  res.send("系統運行中🔥");
});

// ⭐ LINE webhook
app.post("/line/webhook", (req, res) => {
  console.log("收到LINE資料:", JSON.stringify(req.body));

  const events = req.body.events || [];

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const text = event.message.text.trim();

      console.log("使用者說:", text);

      // 👉 如果是數字（司機搶單）
      if (/^\d+$/.test(text)) {
        console.log("司機搶單:", text);
      }
    }
  }

  // ⭐ 一定要回200
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
