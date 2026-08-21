const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

async function sendTelegramFile(method, fieldName, fileUrl, extra = {}) {
  const fileRes = await fetch(fileUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
  });

  if (!fileRes.ok) throw new Error(`Gagal unduh sumber media (${fileRes.status})`);
  const blob = await fileRes.blob();

  const form = new FormData();
  for (const [key, value] of Object.entries(extra)) {
    form.append(key, String(value));
  }
  form.append(fieldName, blob, `media_${Date.now()}`);

  const res = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    body: form
  });

  const json = await res.json();
  if (!json.ok) throw new Error(json.description || `Telegram ${method} gagal`);
  return json;
}

async function sendTextMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

async function fetchDownloader(url) {
  const api = `https://ahm7xmakki.com/api/alldl?url=` + encodeURIComponent(url);
  const response = await fetch(api, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }
  });
  const text = await response.text();
  const data = JSON.parse(text);
  if (!response.ok) throw new Error(data?.message || "Gagal mengambil data media.");
  return data?.data?.mediaInfo || data?.mediaInfo || data?.result || data?.data || data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).json({ ok: true, status: "online" });

  try {
    const update = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const message = update?.message;
    if (!message?.chat?.id || !message?.text) return res.status(200).json({ ok: true });

    const chatId = message.chat.id;
    const text = message.text.trim();

    if (text === "/start" || text === "/help") {
      await sendTextMessage(chatId, "👋 Kirim link TikTok atau Instagram untuk mendownload media.");
      return res.status(200).json({ ok: true });
    }

    const isSupported = text.includes("tiktok.com") || text.includes("instagram.com") || text.includes("instagr.am");
    if (!isSupported) {
      await sendTextMessage(chatId, "❌ Kirim link TikTok atau Instagram yang valid.");
      return res.status(200).json({ ok: true });
    }

    await sendTextMessage(chatId, "⏳ Mengunduh dan memproses media...");

    const root = await fetchDownloader(text);
    const title = root?.title || "Cloupanz Media";
    const videoUrl = root?.videoUrl || root?.video_url || root?.url || "";
    const images = root?.images || root?.photos || (root?.thumbnail ? [root.thumbnail] : []);
    const audioUrl = root?.audioUrl || root?.audio_url || root?.music || "";
    const isPhotoUrl = text.includes("/photo/") || text.includes("/photo");

    // 1. Upload Video langsung via Buffer
    if (videoUrl && !isPhotoUrl) {
      await sendTelegramFile("sendVideo", "video", videoUrl, {
        chat_id: chatId,
        caption: `🎬 ${title}\n\n☁️ Cloupanz`,
        supports_streaming: "true"
      });
    }
    // 2. Upload Foto/Carousel via Buffer
    else if (images.length > 0) {
      for (let i = 0; i < Math.min(images.length, 10); i++) {
        await sendTelegramFile("sendPhoto", "photo", images[i], {
          chat_id: chatId,
          caption: i === 0 ? `🖼️ ${title}\n\n☁️ Cloupanz` : ""
        });
      }
    }

    // 3. Upload Audio jika ada
    if (audioUrl) {
      await sendTelegramFile("sendAudio", "audio", audioUrl, {
        chat_id: chatId,
        caption: `🎵 ${title}\n\n☁️ Cloupanz`,
        title: "Audio Musik"
      });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("WEBHOOK ERROR:", error);
    return res.status(200).json({ ok: false, error: error.message });
  }
  }
