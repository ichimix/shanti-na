import express from "express";
import line from "@line/bot-sdk";
import OpenAI from "openai";

const app = express();
app.use(express.json());

// ヘルスチェック（必ず200）
app.get("/", (_, res) => res.status(200).send("ok"));

// LINE Webhook 入口（ここでだけLINE/AIを初期化）
app.post("/webhook", async (req, res) => {
  const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
  const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // 未設定でもOK

  // 署名検証に必要な2つが無いときはエラー内容を返す（原因判別用）
  if (!LINE_CHANNEL_SECRET || !LINE_ACCESS_TOKEN) {
    console.error("Missing LINE envs:", {
      hasSecret: !!LINE_CHANNEL_SECRET,
      hasToken: !!LINE_ACCESS_TOKEN,
    });
    // Verifyが分かるように200でメッセージ返す
    return res
      .status(200)
      .send("LINE env missing: set LINE_CHANNEL_SECRET and LINE_ACCESS_TOKEN");
  }

  // LINE SDK 準備（ここでだけ作る）
  const config = {
    channelSecret: LINE_CHANNEL_SECRET,
    channelAccessToken: LINE_ACCESS_TOKEN,
  };
  const middleware = line.middleware(config);
  const client = new line.Client(config);

  // まず署名検証ミドルウェアを通す
  middleware(req, res, async () => {
    try {
      const results = await Promise.all((req.body.events || []).map((ev) => handleEvent(ev, client, OPENAI_API_KEY)));
      return res.json(results);
    } catch (e) {
      console.error("webhook error:", e);
      return res.status(200).send("handled"); // LINEには200で返す（再送防止）
    }
  });
});

// イベント処理（OpenAIはキーがあるときだけ使う）
async function handleEvent(event, client, OPENAI_API_KEY) {
  if (event.type !== "message" || event.message.type !== "text") {
    return Promise.resolve(null);
  }

  const userText = (event.message.text || "").trim();

  // OpenAI未設定なら簡易エコーで返しておく（起動確認用）
  if (!OPENAI_API_KEY) {
    return client.replyMessage(event.replyToken, [
      { type: "text", text: "✅ Bot稼働中（OpenAI未設定）。あなたの入力：" },
      { type: "text", text: userText.slice(0, 1000) },
    ]);
  }

  const ai = new OpenAI({ apiKey: OPENAI_API_KEY });

  const prompt = `
中小企業向けの業務効率化提案をしてください。簡潔に答えてください。

出力:
- 課題要約（1行）
- 解決案（最大3つ・箇条書き）
  - 使うツール
  - 実装ステップ（3手順以内）
  - 概算コスト

相談文: 「${userText}」
`.trim();

  let answer = "提案の生成に失敗しました。もう一度お試しください。";
  try {
    const completion = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      max_tokens: 350,
      messages: [
        { role: "system", content: "簡潔で実用的な業務効率化提案をする。3つ以内の解決案を短く回答。" },
        { role: "user", content: prompt },
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

// Vercel用エクスポート（常駐サーバは立てない）
export default function handler(req, res) {
  return app(req, res);
}