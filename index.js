import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

app.post("/line/webhook", async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type !== "message") continue;

    const text = event.message.text;
    console.log("使用者說:", text);

    await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        replyToken: event.replyToken,
        messages: [
          {
            type: "text",
            text: `你剛剛說：${text}`
          }
        ]
      })
    });
  }

  res.sendStatus(200);
});

app.listen(10000, () => {
  console.log("Server running on port 10000");
});
