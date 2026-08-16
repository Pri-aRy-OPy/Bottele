const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

const TELEGRAM_API =
  `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

async function telegram(method, data) {
  const response = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });

  return response.json();
}

function detectPlatform(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();

    if (
      host === "tiktok.com" ||
      host.endsWith(".tiktok.com")
    ) {
      return "TikTok";
    }

    if (
      host === "instagram.com" ||
      host.endsWith(".instagram.com")
    ) {
      return "Instagram";
    }

    return null;
  } catch {
    return null;
  }
}

function isValidUrl(text) {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      message: "Telegram downloader webhook aktif"
    });
  }

  try {
    const update = req.body;
    const message = update?.message;

    if (!message?.chat?.id) {
      return res.status(200).json({ ok: true });
    }

    const chatId = message.chat.id;
    const text = message.text?.trim() || "";

    if (text === "/start") {
      await telegram("sendMessage", {
        chat_id: chatId,
        text:
`🎬 VIDEO DOWNLOADER

Kirim link TikTok atau Instagram publik.

Contoh:
https://www.tiktok.com/...
https://www.instagram.com/...`
      });

      return res.status(200).json({ ok: true });
    }

    if (text === "/help") {
      await telegram("sendMessage", {
        chat_id: chatId,
        text:
`📚 Bantuan

• Kirim link TikTok
• Kirim link Instagram
• Pastikan konten dapat diakses secara publik

Bot akan mengenali platform secara otomatis.`
      });

      return res.status(200).json({ ok: true });
    }

    if (!isValidUrl(text)) {
      await telegram("sendMessage", {
        chat_id: chatId,
        text: "❌ Kirim URL TikTok atau Instagram yang valid."
      });

      return res.status(200).json({ ok: true });
    }

    const platform = detectPlatform(text);

    if (!platform) {
      await telegram("sendMessage", {
        chat_id: chatId,
        text:
          "❌ Platform tidak didukung.\n\nSaat ini: TikTok dan Instagram."
      });

      return res.status(200).json({ ok: true });
    }

    await telegram("sendMessage", {
      chat_id: chatId,
      text:
        `⏳ Link ${platform} diterima.\n\n` +
        `Downloader backend belum dikonfigurasi.\n` +
        `URL sudah berhasil dideteksi.`
    });

    /*
      DI SINI nanti kita hubungkan ke downloader API
      yang kamu pilih.

      Contoh konsep:

      const result = await fetch(DOWNLOADER_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.DOWNLOADER_KEY}`
        },
        body: JSON.stringify({
          url: text
        })
      });

      const data = await result.json();

      Kemudian URL hasil download dikirim
      menggunakan sendVideo/sendAudio.
    */

    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      ok: false,
      error: "Internal server error"
    });
  }
        }
