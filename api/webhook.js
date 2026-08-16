const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;

const TG = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

async function telegram(method, data) {
  const r = await fetch(`${TG}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });

  return r.json();
}

function firestoreUrl(path = "") {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}?key=${FIREBASE_API_KEY}`;
}

async function saveUser(user) {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY) {
    console.log("Firebase belum dikonfigurasi");
    return;
  }

  const userId = String(user.id);

  const data = {
    fields: {
      telegram_id: {
        stringValue: userId
      },
      username: {
        stringValue: user.username || ""
      },
      first_name: {
        stringValue: user.first_name || ""
      },
      last_name: {
        stringValue: user.last_name || ""
      },
      last_seen: {
        timestampValue: new Date().toISOString()
      }
    }
  };

  const url = firestoreUrl(`users/${encodeURIComponent(userId)}`);

  await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      message: "Bottele webhook aktif"
    });
  }

  try {
    const update = req.body;
    const message = update?.message;

    if (!message?.chat?.id) {
      return res.status(200).json({ ok: true });
    }

    const chatId = message.chat.id;
    const user = message.from;
    const text = message.text?.trim() || "";

    // Simpan user ke Firestore
    if (user) {
      await saveUser(user);
    }

    if (text === "/start") {
      await telegram("sendMessage", {
        chat_id: chatId,
        text:
`🎬 BOTTELE DOWNLOADER

Selamat datang ${user?.first_name || ""}!

Kirim link TikTok atau Instagram publik.

📥 Bot akan memproses link secara otomatis.

Perintah:
/start - Mulai bot
/help - Bantuan`
      });

      return res.status(200).json({ ok: true });
    }

    if (text === "/help") {
      await telegram("sendMessage", {
        chat_id: chatId,
        text:
`📚 BANTUAN BOTTELE

Kirim link:
• TikTok
• Instagram

Contoh:
https://www.tiktok.com/...
https://www.instagram.com/...`
      });

      return res.status(200).json({ ok: true });
    }

    const platform = detectPlatform(text);

    if (!platform) {
      await telegram("sendMessage", {
        chat_id: chatId,
        text:
          "❌ Link tidak dikenali.\n\nKirim link TikTok atau Instagram."
      });

      return res.status(200).json({ ok: true });
    }

    await telegram("sendMessage", {
      chat_id: chatId,
      text:
        `⏳ Link ${platform} diterima.\n\n` +
        `🔎 Sedang memproses...`
    });

    /*
      DOWNLOAD API AKAN DIPASANG DI SINI.
    */

    return res.status(200).json({
      ok: true,
      platform
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
