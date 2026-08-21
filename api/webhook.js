const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 5);
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

async function telegram(method, data) {
  const r = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  const json = await r.json();
  if (!json?.ok) throw new Error(json?.description || `Telegram ${method} gagal`);
  return json;
}

function detectPlatform(url) {
  if (url.includes("tiktok.com")) return "TikTok";
  if (url.includes("instagram.com") || url.includes("instagr.am")) return "Instagram";
  return null;
}

async function fetchDownloader(url) {
  const api = `https://ahm7xmakki.com/api/alldl?url=` + encodeURIComponent(url);
  const response = await fetch(api, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } });
  const text = await response.text();
  const data = JSON.parse(text);
  if (!response.ok) throw new Error(data?.message || "Gagal mengambil data media.");
  return data?.data?.mediaInfo || data?.mediaInfo || data?.result || data?.data || data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true, bot: "Cloupanz", status: "online" });
  }

  try {
    const update = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const message = update?.message;
    if (!message?.chat?.id || !message?.text) return res.status(200).json({ ok: true });

    const chatId = message.chat.id;
    const text = message.text.trim();

    if (text === "/start" || text === "/help") {
      await telegram("sendMessage", {
        chat_id: chatId,
        text: "👋 Halo! Kirim link TikTok atau Instagram untuk mendownload video, foto, atau audio."
      });
      return res.status(200).json({ ok: true });
    }

    const platform = detectPlatform(text);
    if (!platform) {
      await telegram("sendMessage", { chat_id: chatId, text: "❌ Kirim link TikTok atau Instagram yang valid." });
      return res.status(200).json({ ok: true });
    }

    await telegram("sendMessage", { chat_id: chatId, text: `⏳ Mengambil media ${platform}...` });

    const root = await fetchDownloader(text);
    const title = root?.title || "Cloupanz Media";
    const videoUrl = root?.videoUrl || root?.video_url || root?.url || "";
    const images = root?.images || root?.photos || (root?.thumbnail ? [root.thumbnail] : []);
    const audioUrl = root?.audioUrl || root?.audio_url || root?.music || "";

    // Kirim Video
    if (videoUrl && !text.includes("/photo")) {
      await telegram("sendVideo", {
        chat_id: chatId,
        video: videoUrl,
        supports_streaming: true,
        caption: `🎬 ${title}\n\nSumber: ${platform}\n☁️ Cloupanz`
      });
    } 
    // Kirim Foto / Carousel
    else if (images.length > 0) {
      if (images.length === 1) {
        await telegram("sendPhoto", {
          chat_id: chatId,
          photo: images[0],
          caption: `🖼️ ${title}\n\nSumber: ${platform}\n☁️ Cloupanz`
        });
      } else {
        const mediaGroup = images.slice(0, 10).map((img, i) => ({
          type: "photo",
          media: img,
          caption: i === 0 ? `🖼️ ${title}\n\nSumber: ${platform}\n☁️ Cloupanz` : undefined
        }));
        await telegram("sendMediaGroup", { chat_id: chatId, media: mediaGroup });
      }
    }

    // Kirim Audio Musik jika ada
    if (audioUrl) {
      await telegram("sendAudio", {
        chat_id: chatId,
        audio: audioUrl,
        title: "Audio Musik",
        caption: `🎵 ${title}\n\n☁️ Cloupanz`
      });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("ERROR:", error);
    return res.status(200).json({ ok: false, error: error.message });
  }
}
