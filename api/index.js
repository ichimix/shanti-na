// api/index.js  ← これ1ファイルでOK
import express from "express";
import line from "@line/bot-sdk";
import OpenAI from "openai";

const app = express();
app.use(express.json());

// ★重要★ Vercelではこのファイルは /api にマウントされる
// なのでここでは "/health" と "/webhook" のように書く
app.get("/health", (_, res) => res.status(200).send("ok"));

app.post("/webhook", async (req, res) => {
  const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
  const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // 無くても動く

  if (!LINE_CHANNEL_SECRET || !LINE_ACCESS_TOKEN) {
    console.error("Missing LINE envs:", {
      hasSecret: !!LINE_CHANNEL_SECRET,
      hasToken: !!LINE_ACCESS_TOKEN,
    });
    // LINEの「接続確認」用に200でメッセージ返す
    return res
      .status(200)
      .send("LINE env missing: set LINE_CHANNEL_SECRET and LINE_ACCESS_TOKEN");
  }

  // LINE SDK（ここで初期化）
  const config = {
    channelSecret: LINE_CHANNEL_SECRET,
    channelAccessToken: LINE_ACCESS_TOKEN,
  };
  const middleware = line.middleware(config);
  const client = new line.Client(config);

  // 署名検証
  middleware(req, res, async () => {
    try {
      const events = req.body.events || [];
      const results = await Promise.all(
        events.map((ev) => handleEvent(ev, client, OPENAI_API_KEY))
      );
      return res.json(results);
    } catch (e) {
      console.error("webhook error:", e);
      // 再送防止のため常に200を返す
      return res.status(200).send("handled");
    }
  });
});

async function handleEvent(event, client, OPENAI_API_KEY) {
  if (event.type !== "message" || event.message.type !== "text") {
    return null;
  }

  const text = (event.message.text || "").trim();

  // OpenAI が無ければエコー
  if (!OPENAI_API_KEY) {
    return client.replyMessage(event.replyToken, [
      { type: "text", text: "✅ Bot稼働中（OpenAI未設定）。あなたの入力：" },
      { type: "text", text: text.slice(0, 1000) },
    ]);
  }

  // OpenAI あり版（軽量設定）
  const ai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const prompt = `中小企業向けの業務効率化コンサルとして、日本語で簡潔に提案。
- 課題要約（1行）
- 解決案（3つまで、箇条書き）
- ツール/手順（簡潔）
相談文: 「${text}」`;

  let answer = "提案の生成に失敗しました。もう一度お試しください。";
  try {
    const completion = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      max_tokens: 350,
      messages: [
        { role: "system", content: "冗長にせず具体的に答える。" },
        { role: "user", content: prompt },
      ],
    });
    answer = completion.choices?.[0]?.message?.content?.trim() || answer;
  } catch (e) {
    console.error("AI error:", e);
    answer = "AI提案の生成でエラー。キーワード（請求書/予約/レポート等）で再入力してください。";
  }

  return client.replyMessage(event.replyToken, [
    { type: "text", text: "🔎 お困り事を分析しました。提案をお送りします。" },
    { type: "text", text: answer.slice(0, 5000) },
  ]);
}

// Vercelハンドラ（Expressを渡すだけ）
export default function handler(req, res) {
  return app(req, res);
}