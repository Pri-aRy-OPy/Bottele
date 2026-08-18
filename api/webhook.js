const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const ADMIN_PIN = process.env.ADMIN_PIN;
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 5);

const TELEGRAM_API =
  `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function firestoreBase() {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

function userDoc(userId) {
  return String(userId);
}

async function telegram(method, data) {
  const response = await fetch(
    `${TELEGRAM_API}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    }
  );

  return await response.json();
}

async function getUser(userId) {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY) {
    return null;
  }

  const url =
    `${firestoreBase()}/users/${encodeURIComponent(userDoc(userId))}` +
    `?key=${FIREBASE_API_KEY}`;

  const response = await fetch(url);

  if (!response.ok) {
    return null;
  }

  return await response.json();
}

async function saveUser(user) {
  if (
    !FIREBASE_PROJECT_ID ||
    !FIREBASE_API_KEY ||
    !user?.id
  ) {
    return;
  }

  const id = userDoc(user.id);
  const old = await getUser(id);
  const currentDate = today();

  let downloads =
    Number(
      old?.fields?.downloads?.integerValue || 0
    );

  let lastReset =
    old?.fields?.last_reset?.stringValue || "";

  if (lastReset !== currentDate) {
    downloads = 0;
    lastReset = currentDate;
  }

  const data = {
    fields: {
      telegram_id: {
        stringValue: String(user.id)
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
      downloads: {
        integerValue: String(downloads)
      },
      last_reset: {
        stringValue: currentDate
      },
      is_admin: {
        booleanValue:
          old?.fields?.is_admin?.booleanValue === true
      },
      last_seen: {
        timestampValue: new Date().toISOString()
      }
    }
  };

  const url =
    `${firestoreBase()}/users/${encodeURIComponent(id)}` +
    `?key=${FIREBASE_API_KEY}`;

  await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });
}

async function isAdmin(userId) {
  const user = await getUser(userId);

  return (
    user?.fields?.is_admin?.booleanValue === true
  );
}

async function claimAdmin(user) {
  if (!ADMIN_PIN) {
    return {
      ok: false,
      message: "PIN admin belum dikonfigurasi."
    };
  }

  if (
    !FIREBASE_PROJECT_ID ||
    !FIREBASE_API_KEY
  ) {
    return {
      ok: false,
      message: "Firebase belum dikonfigurasi."
    };
  }

  const configUrl =
    `${firestoreBase()}/config/bot` +
    `?key=${FIREBASE_API_KEY}`;

  const check = await fetch(configUrl);

  if (check.ok) {
    const config = await check.json();

    const existingAdmin =
      config?.fields?.admin_id?.stringValue;

    if (existingAdmin) {
      return {
        ok: false,
        message: "Admin sudah terdaftar."
      };
    }
  }

  if (user.__adminPin !== ADMIN_PIN) {
    return {
      ok: false,
      message: "PIN salah."
    };
  }

  const configData = {
    fields: {
      admin_id: {
        stringValue: String(user.id)
      },
      admin_username: {
        stringValue: user.username || ""
      },
      created_at: {
        timestampValue: new Date().toISOString()
      }
    }
  };

  const saveConfig = await fetch(
    configUrl,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(configData)
    }
  );

  if (!saveConfig.ok) {
    return {
      ok: false,
      message: "Gagal menyimpan admin."
    };
  }

  const userId = String(user.id);

  const userUrl =
    `${firestoreBase()}/users/${encodeURIComponent(userId)}` +
    `?key=${FIREBASE_API_KEY}`;

  const old = await getUser(userId);

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
      downloads: {
        integerValue:
          String(
            old?.fields?.downloads?.integerValue || 0
          )
      },
      last_reset: {
        stringValue: today()
      },
      is_admin: {
        booleanValue: true
      },
      last_seen: {
        timestampValue: new Date().toISOString()
      }
    }
  };

  await fetch(userUrl, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });

  return {
    ok: true
  };
}

async function getDownloadStatus(userId) {
  const user = await getUser(userId);

  if (!user) {
    return {
      downloads: 0,
      remaining: DAILY_LIMIT,
      admin: false
    };
  }

  const admin =
    user?.fields?.is_admin?.booleanValue === true;

  if (admin) {
    return {
      downloads: 0,
      remaining: Infinity,
      admin: true
    };
  }

  const lastReset =
    user?.fields?.last_reset?.stringValue || "";

  let downloads =
    Number(
      user?.fields?.downloads?.integerValue || 0
    );

  if (lastReset !== today()) {
    downloads = 0;
  }

  return {
    downloads,
    remaining:
      Math.max(
        DAILY_LIMIT - downloads,
        0
      ),
    admin: false
  };
}

async function addDownload(user) {
  const old = await getUser(user.id);
  const currentDate = today();

  let downloads =
    Number(
      old?.fields?.downloads?.integerValue || 0
    );

  const lastReset =
    old?.fields?.last_reset?.stringValue || "";

  if (lastReset !== currentDate) {
    downloads = 0;
  }

  downloads++;

  const url =
    `${firestoreBase()}/users/${encodeURIComponent(String(user.id))}` +
    `?key=${FIREBASE_API_KEY}`;

  const data = {
    fields: {
      telegram_id: {
        stringValue: String(user.id)
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
      downloads: {
        integerValue: String(downloads)
      },
      last_reset: {
        stringValue: currentDate
      },
      is_admin: {
        booleanValue:
          old?.fields?.is_admin?.booleanValue === true
      },
      last_seen: {
        timestampValue: new Date().toISOString()
      }
    }
  };

  await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });

  return downloads;
}

function detectPlatform(url) {
  try {
    const host =
      new URL(url)
        .hostname
        .toLowerCase()
        .replace(/^www\./, "");

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

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );
  } catch {
    return false;
  }
}

async function downloadInfo(url) {
  const apiUrl =
    `https://ahm7xmakki.com/api/alldl?url=` +
    encodeURIComponent(url);

  const response = await fetch(apiUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 Cloupanz Downloader"
    }
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "Downloader API tidak merespons dengan benar."
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      `API error ${response.status}`
    );
  }

  const root =
    data?.mediaInfo ||
    data?.data?.mediaInfo ||
    data?.result?.mediaInfo ||
    data?.result ||
    data?.data ||
    data;

  const title =
    root?.title ||
    data?.title ||
    "Cloupanz Download";

  const thumbnail =
    root?.thumbnail ||
    root?.thumbnailUrl ||
    root?.thumbnail_url ||
    data?.thumbnail ||
    "";

  const videoUrl =
    root?.videoUrl ||
    root?.video_url ||
    root?.downloadUrl ||
    root?.download_url ||
    root?.video ||
    "";

  const audioUrl =
    root?.audioUrl ||
    root?.audio_url ||
    root?.audio ||
    "";

  const images = [];

  const add = value => {
    if (typeof value !== "string") return;

    try {
      const parsed = new URL(value);

      if (
        parsed.protocol === "http:" ||
        parsed.protocol === "https:"
      ) {
        images.push(value);
      }
    } catch {}
  };

  const addObject = item => {
    if (!item) return;

    if (typeof item === "string") {
      add(item);
      return;
    }

    if (typeof item !== "object") return;

    add(
      item.url ||
      item.imageUrl ||
      item.image_url ||
      item.downloadUrl ||
      item.download_url ||
      item.src ||
      item.source
    );
  };

  const sources = [
    root?.images,
    root?.imageUrls,
    root?.image_urls,
    root?.photos,
    root?.photoUrls,
    root?.photo_urls,
    root?.media,
    root?.items,
    root?.slides,
    root?.carousel,
    root?.carouselMedia,
    root?.carousel_media,
    data?.images,
    data?.photos,
    data?.media
  ];

  for (const source of sources) {
    if (!Array.isArray(source)) continue;

    for (const item of source) {
      addObject(item);
    }
  }

  add(root?.image);
  add(root?.imageUrl);
  add(root?.image_url);
  add(root?.photo);
  add(root?.photoUrl);
  add(root?.photo_url);
  add(data?.image);
  add(data?.imageUrl);

  const walk = (value, depth = 0) => {
    if (!value || depth > 5) return;

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item, depth + 1);
      }
      return;
    }

    if (typeof value !== "object") return;

    for (const [key, item] of Object.entries(value)) {
      const lower = key.toLowerCase();

      if (
        typeof item === "string" &&
        (
          lower.includes("image") ||
          lower.includes("photo") ||
          lower === "src"
        )
      ) {
        add(item);
      }

      if (
        Array.isArray(item) &&
        (
          lower.includes("image") ||
          lower.includes("photo") ||
          lower.includes("media") ||
          lower.includes("carousel")
        )
      ) {
        for (const entry of item) {
          addObject(entry);
          walk(entry, depth + 1);
        }
      }

      if (item && typeof item === "object") {
        walk(item, depth + 1);
      }
    }
  };

  walk(root);
  walk(data);

  const uniqueImages = [
    ...new Set(images)
  ];

  if (
    !videoUrl &&
    root?.url &&
    String(root?.type || "").toLowerCase() === "video"
  ) {
    return {
      type: "video",
      title,
      thumbnail,
      videoUrl: root.url,
      audioUrl: "",
      images: []
    };
  }

  if (
    !audioUrl &&
    root?.url &&
    String(root?.type || "").toLowerCase() === "audio"
  ) {
    return {
      type: "audio",
      title,
      thumbnail,
      videoUrl: "",
      audioUrl: root.url,
      images: []
    };
  }

  if (
    !videoUrl &&
    !audioUrl &&
    !uniqueImages.length
  ) {
    throw new Error(
      "Media tidak ditemukan dari API downloader."
    );
  }

  let type = "unknown";

  if (
    uniqueImages.length &&
    !videoUrl &&
    !audioUrl
  ) {
    type =
      uniqueImages.length > 1
        ? "carousel"
        : "image";
  } else if (videoUrl) {
    type = "video";
  } else if (audioUrl) {
    type = "audio";
  }

  return {
    type,
    title,
    thumbnail,
    videoUrl,
    audioUrl,
    images: uniqueImages
  };
}

async function sendVideo(
  chatId,
  videoUrl,
  title,
  platform
) {
  return await telegram(
    "sendVideo",
    {
      chat_id: chatId,
      video: videoUrl,
      supports_streaming: true,
      caption:
        `🎬 ${title}\n\n` +
        `Sumber: ${platform}\n` +
        `☁️ Cloupanz`
    }
  );
}

async function sendAudio(
  chatId,
  audioUrl,
  title,
  platform
) {
  return await telegram(
    "sendAudio",
    {
      chat_id: chatId,
      audio: audioUrl,
      title: title,
      caption:
        `🎵 ${title}\n\n` +
        `Sumber: ${platform}\n` +
        `☁️ Cloupanz`
    }
  );
}

async function sendSinglePhoto(
  chatId,
  imageUrl,
  title,
  platform
) {
  return await telegram(
    "sendPhoto",
    {
      chat_id: chatId,
      photo: imageUrl,
      caption:
        `🖼️ ${title}\n\n` +
        `Sumber: ${platform}\n` +
        `☁️ Cloupanz`
    }
  );
}

async function sendPhotoGroup(
  chatId,
  images,
  title,
  platform
) {
  const chunks = [];

  for (let i = 0; i < images.length; i += 10) {
    chunks.push(
      images.slice(i, i + 10)
    );
  }

  const results = [];

  for (const chunk of chunks) {
    const media = chunk.map(
      (image, index) => ({
        type: "photo",
        media: image,
        caption:
          index === 0
            ? `🖼️ ${title}\n\n` +
              `Sumber: ${platform}\n` +
              `☁️ Cloupanz`
            : undefined
      })
    );

    const result =
      await telegram(
        "sendMediaGroup",
        {
          chat_id: chatId,
          media
        }
      );

    results.push(result);

    if (!result?.ok) {
      throw new Error(
        result?.description ||
        "Telegram gagal mengirim foto."
      );
    }
  }

  return results;
}

async function sendMedia(
  chatId,
  info,
  platform
) {
  if (info.type === "video") {
    return await sendVideo(
      chatId,
      info.videoUrl,
      info.title,
      platform
    );
  }

  if (info.type === "audio") {
    return await sendAudio(
      chatId,
      info.audioUrl,
      info.title,
      platform
    );
  }

  if (info.type === "image") {
    return await sendSinglePhoto(
      chatId,
      info.images[0],
      info.title,
      platform
    );
  }

  if (info.type === "carousel") {
    return await sendPhotoGroup(
      chatId,
      info.images,
      info.title,
      platform
    );
  }

  if (info.images?.length) {
    if (info.images.length === 1) {
      return await sendSinglePhoto(
        chatId,
        info.images[0],
        info.title,
        platform
      );
    }

    return await sendPhotoGroup(
      chatId,
      info.images,
      info.title,
      platform
    );
  }

  throw new Error(
    "Jenis media tidak didukung."
  );
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      bot: "Cloupanz Downloader",
      status: "online",
      platforms: [
        "TikTok",
        "Instagram"
      ]
    });
  }

  try {
    if (!TELEGRAM_TOKEN) {
      return res.status(500).json({
        ok: false,
        error:
          "TELEGRAM_TOKEN belum dipasang."
      });
    }

    const update = req.body;
    const message = update?.message;

    if (!message?.chat?.id) {
      return res.status(200).json({
        ok: true
      });
    }

    const chatId = message.chat.id;
    const user = message.from;
    const text =
      message.text?.trim() || "";

    await saveUser(user);

    if (
      text === "/start" ||
      text.startsWith("/start ")
    ) {
      await telegram(
        "sendMessage",
        {
          chat_id: chatId,
          text:
`Halo ${user?.first_name || "kak"} 👋

Kirim link TikTok atau Instagram.

Bisa mengambil:
🎬 Video
🖼️ Foto
🖼️ Carousel
🎵 Audio

📌 Limit harian: ${DAILY_LIMIT}

/help untuk bantuan
/limit untuk melihat limit`
        }
      );

      return res.status(200).json({
        ok: true
      });
    }

    if (text === "/help") {
      await telegram(
        "sendMessage",
        {
          chat_id: chatId,
          text:
`📖 Cara pakai

1. Salin link TikTok atau Instagram
2. Kirim ke bot
3. Tunggu sebentar
4. Media akan dikirim otomatis

Media yang didukung:
🎬 Video
🖼️ Foto
🖼️ Carousel
🎵 Audio

/limit — cek limit`
        }
      );

      return res.status(200).json({
        ok: true
      });
    }

    if (
      text === "/limit" ||
      text === "/me"
    ) {
      const status =
        await getDownloadStatus(user.id);

      if (status.admin) {
        await telegram(
          "sendMessage",
          {
            chat_id: chatId,
            text:
`👑 Admin Cloupanz

Limit download:
∞ Tanpa batas`
          }
        );
      } else {
        await telegram(
          "sendMessage",
          {
            chat_id: chatId,
            text:
`📊 Limit kamu

Hari ini:
${status.downloads}/${DAILY_LIMIT}

Sisa:
${status.remaining} download`
          }
        );
      }

      return res.status(200).json({
        ok: true
      });
    }

    if (
      text.startsWith("/admin ")
    ) {
      const pin =
        text
          .slice(7)
          .trim();

      const adminUser = {
        ...user,
        __adminPin: pin
      };

      const result =
        await claimAdmin(
          adminUser
        );

      await telegram(
        "sendMessage",
        {
          chat_id: chatId,
          text: result.ok
            ? `👑 Admin berhasil diaktifkan.

Selamat datang di
Cloupanz Control Panel.

Kamu sekarang punya akses
tanpa limit.`
            : `❌ ${result.message}`
        }
      );

      return res.status(200).json({
        ok: true
      });
    }

    const admin =
      await isAdmin(user.id);

    if (text === "/stats") {
      if (!admin) {
        await telegram(
          "sendMessage",
          {
            chat_id: chatId,
            text:
              "❌ Perintah khusus admin."
          }
        );

        return res.status(200).json({
          ok: true
        });
      }

      const url =
        `${firestoreBase()}/users` +
        `?key=${FIREBASE_API_KEY}`;

      const response =
        await fetch(url);

      const data =
        await response.json();

      const users =
        data.documents || [];

      let totalDownloads = 0;

      for (const item of users) {
        totalDownloads +=
          Number(
            item?.fields?.downloads?.integerValue || 0
          );
      }

      await telegram(
        "sendMessage",
        {
          chat_id: chatId,
          text:
`📊 Cloupanz Stats

👥 Users:
${users.length}

🎬 Download:
${totalDownloads}

👑 Admin:
Aktif`
        }
      );

      return res.status(200).json({
        ok: true
      });
    }

    if (!text) {
      return res.status(200).json({
        ok: true
      });
    }

    if (!isValidUrl(text)) {
      await telegram(
        "sendMessage",
        {
          chat_id: chatId,
          text:
            "Kirim link TikTok atau Instagram ya 🙂"
        }
      );

      return res.status(200).json({
        ok: true
      });
    }

    const platform =
      detectPlatform(text);

    if (!platform) {
      await telegram(
        "sendMessage",
        {
          chat_id: chatId,
          text:
`Belum bisa untuk link itu.

Saat ini:
🎵 TikTok
📸 Instagram`
        }
      );

      return res.status(200).json({
        ok: true
      });
    }

    const status =
      await getDownloadStatus(
        user.id
      );

    if (
      !status.admin &&
      status.remaining <= 0
    ) {
      await telegram(
        "sendMessage",
        {
          chat_id: chatId,
          text:
`Limit hari ini sudah habis 😅
Batas:
${DAILY_LIMIT} download/hari

Coba lagi besok.`
        }
      );

      return res.status(200).json({
        ok: true
      });
    }

    const processing =
      await telegram(
        "sendMessage",
        {
          chat_id: chatId,
          text:
`⏳ Tunggu sebentar...

🔎 Mengambil media ${platform}...`
        }
      );

    try {
      const info =
        await downloadInfo(text);

      await sendMedia(
        chatId,
        info,
        platform
      );

      if (!status.admin) {
        await addDownload(user);
      }

      if (processing?.result?.message_id) {
        await telegram(
          "deleteMessage",
          {
            chat_id: chatId,
            message_id:
              processing.result.message_id
          }
        ).catch(() => {});
      }

      return res.status(200).json({
        ok: true,
        type: info.type,
        count: info.images?.length || 0
      });
    } catch (error) {
      console.error(
        "DOWNLOAD ERROR:",
        error
      );

      await telegram(
        "sendMessage",
        {
          chat_id: chatId,
          text:
            `❌ Gagal mengambil media.\n\n` +
            `${error?.message || "Terjadi kesalahan."}`
        }
      );

      return res.status(200).json({
        ok: true,
        error: true
      });
    }
  } catch (error) {
    console.error(
      "WEBHOOK ERROR:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        "Webhook error."
    });
  }
}
