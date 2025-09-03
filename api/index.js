import express from "express";
import line from "@line/bot-sdk";
import OpenAI from "openai";

const app = express();
app.use(express.json());

// ヘルスチェック
app.get("/api/health", (_, res) => res.status(200).send("ok"));

// LINE Webhook
app.post("/api/webhook", async (req, res) => {
  const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
  const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // 任意

  if (!LINE_CHANNEL_SECRET || !LINE_ACCESS_TOKEN) {
    console.error("Missing LINE envs:", {
      hasSecret: !!LINE_CHANNEL_SECRET,
      hasToken: !!LINE_ACCESS_TOKEN,
    });
    return res
      .status(200)
      .send("LINE env missing: set LINE_CHANNEL_SECRET and LINE_ACCESS_TOKEN");
  }

  const config = {
    channelSecret: LINE_CHANNEL_SECRET,
    channelAccessToken: LINE_ACCESS_TOKEN,
  };
  const middleware = line.middleware(config);
  const client = new line.Client(config);

  middleware(req, res, async () => {
    try {
      const results = await Promise.all(
        (req.body.events || []).map((ev) =>
          handleEvent(ev, client, OPENAI_API_KEY)
        )
      );
      return res.json(results);
    } catch (e) {
      console.error("webhook error:", e);
      return res.status(200).send("handled");
    }
  });
});

// イベント処理
async function handleEvent(event, client, OPENAI_API_KEY) {
  if (event.type !== "message" || event.message.type !== "text") {
    return Promise.resolve(null);
  }

  const userText = (event.message.text || "").trim();

  // OpenAI未設定ならエコー
  if (!OPENAI_API_KEY) {
    return client.replyMessage(event.replyToken, [
      { type: "text", text: "✅ Bot稼働中（OpenAI未設定）。入力：" },
      { type: "text", text: userText.slice(0, 1000) },
    ]);
  }

  const ai = new OpenAI({ apiKey: OPENAI_API_KEY });

  const prompt = `
あなたは中小企業向けの業務効率化アシスタントです。
相談内容に対して、すぐ試せる現実的な解決策を日本語で簡潔に提案してください。

出力:
- 課題要約（1行）
- 解決案（最大3つ・箇条書き）
  - ツール
  - 手順（3〜5ステップ）
  - 概算コスト/工数
`.trim();

  let answer = "提案の生成に失敗しました。";
  try {
    const completion = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1, // 高速化
      max_tokens: 350,  // 短縮
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: userText },
      ],
    });
    answer = completion.choices?.[0]?.message?.content?.trim() || answer;
  } catch (e) {
    console.error("AI error:", e);
    answer =
      "AI提案の生成でエラー。キーワード（請求書/予約/レポート等）で再入力してください。";
  }

  return client.replyMessage(event.replyToken, [
    { type: "text", text: "🔎 お困り事を分析しました。提案をお送りします。" },
    { type: "text", text: answer.slice(0, 5000) },
  ]);
}

export default function handler(req, res) {
  return app(req, res);
}