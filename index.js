import express from "express";
const app = express();

app.use(express.json());

// 測試首頁
app.get("/", (req, res) => {
  res.send("系統運行中🔥");
});

// LINE Webhook
app.post("/line/webhook", (req, res) => {
  console.log("收到LINE訊息:", JSON.stringify(req.body, null, 2));

  // 一定要回200
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
