import express from "express";
const app = express();

app.get("/", (req, res) => {
  res.send("系統運行中🔥");
});

app.listen(3000, () => console.log("Server running"));
