const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const ADMIN_PIN = process.env.ADMIN_PIN;
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 5);

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function userDoc(userId) {
  return String(userId);
}

function firestoreBase() {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

async function telegram(method, data) {
  const response = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });

  return await response.json();
}

async function getUser(userId) {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY) return null;

  const url =
    `${firestoreBase()}/users/${encodeURIComponent(userDoc(userId))}` +
    `?key=${FIREBASE_API_KEY}`;

  const response = await fetch(url);

  if (!response.ok) return null;

  return await response.json();
}

async function saveUser(user) {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY || !user?.id) {
    return;
  }

  const id = userDoc(user.id);
  const old = await getUser(id);
  const currentDate = today();

  let downloads = Number(
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
        stringValue: lastReset
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

  return user?.fields?.is_admin?.booleanValue === true;
}

async function claimAdmin(user) {
  if (!ADMIN_PIN) {
    return {
      ok: false,
      message: "PIN admin belum dikonfigurasi."
    };
  }

  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY) {
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

  const saveConfig = await fetch(configUrl, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(configData)
  });

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
          String(old?.fields?.downloads?.integerValue || 0)
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

  let downloads = Number(
    user?.fields?.downloads?.integerValue || 0
  );

  if (lastReset !== today()) {
    downloads = 0;
  }

  return {
    downloads,
    remaining: Math.max(
      DAILY_LIMIT - downloads,
      0
    ),
    admin: false
  };
}

async function addDownload(user) {
  const old = await getUser(user.id);

  const currentDate = today();

  let downloads = Number(
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

    if (
      host === "youtube.com" ||
      host === "youtu.be" ||
      host.endsWith(".youtube.com")
    ) {
      return "YouTube";
    }

    if (
      host === "facebook.com" ||
      host === "fb.watch" ||
      host.endsWith(".facebook.com")
    ) {
      return "Facebook";
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

function isUrl(value) {
  if (typeof value !== "string") return false;

  try {
    const url = new URL(value);

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );
  } catch {
    return false;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function detectMediaType(key, value, object) {
  const k = String(key || "").toLowerCase();

  const objectType =
    object?.type ||
    object?.mediaType ||
    object?.mimeType ||
    object?.mime;

  const type =
    String(objectType || "").toLowerCase();

  if (
    type.includes("video") ||
    type.includes("mp4")
  ) {
    return "video";
  }

  if (
    type.includes("audio") ||
    type.includes("mp3") ||
    type.includes("m4a")
  ) {
    return "audio";
  }

  if (
    type.includes("image") ||
    type.includes("photo")
  ) {
    return "image";
  }

  if (
    k.includes("video") ||
    k.includes("video_url") ||
    k === "videourl"
  ) {
    return "video";
  }

  if (
    k.includes("audio") ||
    k.includes("audio_url") ||
    k === "audiourl" ||
    k.includes("music")
  ) {
    return "audio";
  }

  if (
    k.includes("image") ||
    k.includes("photo") ||
    k.includes("picture") ||
    k.includes("images") ||
    k.includes("photos")
  ) {
    return "image";
  }

  if (typeof value === "string") {
    const v = value.toLowerCase();

    if (
      v.includes(".mp4") ||
      v.includes(".webm") ||
      v.includes(".mov") ||
      v.includes(".m4v")
    ) {
      return "video";
    }

    if (
      v.includes(".mp3") ||
      v.includes(".m4a") ||
      v.includes(".aac") ||
      v.includes(".ogg") ||
      v.includes(".wav")
    ) {
      return "audio";
    }

    if (
      v.includes(".jpg") ||
      v.includes(".jpeg") ||
      v.includes(".png") ||
      v.includes(".webp") ||
      v.includes(".gif")
    ) {
      return "image";
    }
  }

  return null;
}

function collectMedia(data) {
  const result = {
    videos: [],
    images: [],
    audios: []
  };

  const seen = new WeakSet();

  function add(type, value) {
    if (!isUrl(value)) return;

    if (type === "video") {
      result.videos.push(value);
    }

    if (type === "image") {
      result.images.push(value);
    }

    if (type === "audio") {
      result.audios.push(value);
    }
  }

  function scan(value, key = "", parent = null) {
    if (value == null) return;

    if (typeof value === "string") {
      const type =
        detectMediaType(
          key,
          value,
          parent
        );

      if (type) {
        add(type, value);
      }

      return;
    }

    if (typeof value !== "object") return;

    if (seen.has(value)) return;

    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        scan(item, key, parent);
      }

      return;
    }

    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "string") {
        const type =
          detectMediaType(
            k,
            v,
            value
          );

        if (type) {
          add(type, v);
        }
      }

      scan(v, k, value);
    }
  }

  scan(data);

  return {
    videos: unique(result.videos),
    images: unique(result.images),
    audios: unique(result.audios)
  };
}

async function downloadInfo(url) {
  const apiUrl =
    `https://ahm7xmakki.com/api/alldl?url=` +
    encodeURIComponent(url);

  const response = await fetch(apiUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 Cloupanz"
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

  const media =
    data?.mediaInfo ||
    data?.data?.mediaInfo ||
    data?.result?.mediaInfo ||
    data?.result ||
    data?.data ||
    data;

  if (!media) {
    throw new Error(
      "Media tidak ditemukan."
    );
  }

  const collected =
    collectMedia(media);

  const title =
    media?.title ||
    data?.title ||
    "Cloupanz Media";

  const thumbnail =
    media?.thumbnail ||
    media?.thumbnailUrl ||
    media?.thumbnail_url ||
    "";

  if (
    typeof media?.videoUrl === "string" &&
    isUrl(media.videoUrl)
  ) {
    collected.videos.unshift(
      media.videoUrl
    );
  }

  if (
    typeof media?.video_url === "string" &&
    isUrl(media.video_url)
  ) {
    collected.videos.unshift(
      media.video_url
    );
  }

  if (
    typeof media?.imageUrl === "string" &&
    isUrl(media.imageUrl)
  ) {
    collected.images.unshift(
      media.imageUrl
    );
  }

  if (
    typeof media?.image_url === "string" &&
    isUrl(media.image_url)
  ) {
    collected.images.unshift(
      media.image_url
    );
  }

  if (
    typeof media?.image === "string" &&
    isUrl(media.image)
  ) {
    collected.images.unshift(
      media.image
    );
  }

  if (
    typeof media?.photo === "string" &&
    isUrl(media.photo)
  ) {
    collected.images.unshift(
      media.photo
    );
  }

  if (
    typeof media?.photoUrl === "string" &&
    isUrl(media.photoUrl)
  ) {
    collected.images.unshift(
      media.photoUrl
    );
  }

  if (
    typeof media?.audioUrl === "string" &&
    isUrl(media.audioUrl)
  ) {
    collected.audios.unshift(
      media.audioUrl
    );
  }

  if (
    typeof media?.audio_url === "string" &&
    isUrl(media.audio_url)
  ) {
    collected.audios.unshift(
      media.audio_url
    );
  }

  collected.videos =
    unique(collected.videos);

  collected.images =
    unique(collected.images);

  collected.audios =
    unique(collected.audios);

  if (
    !collected.videos.length &&
    !collected.images.length &&
    !collected.audios.length
  ) {
    throw new Error(
      "URL media tidak ditemukan dari downloader."
    );
  }

  let type = "unknown";

  if (collected.videos.length) {
    type = "video";
  } else if (collected.images.length > 1) {
    type = "carousel";
  } else if (collected.images.length === 1) {
    type = "image";
  } else if (collected.audios.length) {
    type = "audio";
  }

  return {
    type,
    title,
    thumbnail,
    videos: collected.videos,
    images: collected.images,
    audios: collected.audios
  };
}

async function fetchBuffer(url, maxSize) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (!response.ok) {
    throw new Error(
      `CDN error ${response.status}`
    );
  }

  const contentType =
    response.headers.get("content-type") ||
    "application/octet-stream";

  const contentLength =
    response.headers.get("content-length");

  if (
    contentLength &&
    Number(contentLength) > maxSize
  ) {
    throw new Error(
      "File terlalu besar untuk Telegram."
    );
  }

  const arrayBuffer =
    await response.arrayBuffer();

  const buffer =
    Buffer.from(arrayBuffer);

  if (buffer.length > maxSize) {
    throw new Error(
      "File terlalu besar untuk Telegram."
    );
  }

  return {
    buffer,
    contentType
  };
}

async function sendVideo(
  chatId,
  buffer,
  contentType,
  title,
  platform
) {
  const form = new FormData();

  form.append(
    "chat_id",
    String(chatId)
  );

  form.append(
    "supports_streaming",
    "true"
  );

  form.append(
    "caption",
`🎬 ${title}

Sumber: ${platform}
☁️ Cloupanz`
  );

  form.append(
    "video",
    new Blob(
      [buffer],
      {
        type: contentType
      }
    ),
    "cloupanz.mp4"
  );

  const response =
    await fetch(
      `${TELEGRAM_API}/sendVideo`,
      {
        method: "POST",
        body: form
      }
    );

  return await response.json();
}

async function sendPhoto(
  chatId,
  buffer,
  contentType,
  title,
  platform
) {
  const form = new FormData();

  form.append(
    "chat_id",
    String(chatId)
  );

  form.append(
    "caption",
`🖼️ ${title}

Sumber: ${platform}
☁️ Cloupanz`
  );

  const extension =
    contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
        ? "webp"
        : "jpg";

  form.append(
    "photo",
    new Blob(
      [buffer],
      {
        type: contentType
      }
    ),
    `cloupanz.${extension}`
  );

  const response =
    await fetch(
      `${TELEGRAM_API}/sendPhoto`,
      {
        method: "POST",
        body: form
      }
    );

  return await response.json();
}

async function sendDocument(
  chatId,
  buffer,
  contentType,
  title,
  platform
) {
  const form = new FormData();

  form.append(
    "chat_id",
    String(chatId)
  );

  form.append(
    "caption",
`🖼️ ${title}

Sumber: ${platform}
☁️ Cloupanz`
  );

  form.append(
    "document",
    new Blob(
      [buffer],
      {
        type: contentType
      }
    ),
    "cloupanz-media"
  );

  const response =
    await fetch(
      `${TELEGRAM_API}/sendDocument`,
      {
        method: "POST",
        body: form
      }
    );

  return await response.json();
}

async function sendAudio(
  chatId,
  buffer,
  contentType,
  title,
  platform
) {
  const form = new FormData();

  form.append(
    "chat_id",
    String(chatId)
  );

  form.append(
    "caption",
`🎵 ${title}

Sumber: ${platform}
☁️ Cloupanz`
  );

  form.append(
    "audio",
    new Blob(
      [buffer],
      {
        type: contentType
      }
    ),
    "cloupanz-audio"
  );

  const response =
    await fetch(
      `${TELEGRAM_API}/sendAudio`,
      {
        method: "POST",
        body: form
      }
    );

  return await response.json();
}

async function sendMedia(
  chatId,
  info,
  platform
) {
  let sent = 0;

  if (info.videos.length) {
    for (const videoUrl of info.videos) {
      const media =
        await fetchBuffer(
          videoUrl,
          49 * 1024 * 1024
        );

      const result =
        await sendVideo(
          chatId,
          media.buffer,
          media.contentType,
          info.title,
          platform
        );

      if (!result?.ok) {
        throw new Error(
          result?.description ||
          "Telegram gagal mengirim video."
        );
      }

      sent++;
    }
  }

  if (info.images.length) {
    for (const imageUrl of info.images) {
      const media =
        await fetchBuffer(
          imageUrl,
          10 * 1024 * 1024
        );

      let result =
        await sendPhoto(
          chatId,
          media.buffer,
          media.contentType,
          info.title,
          platform
        );

      if (!result?.ok) {
        result =
          await sendDocument(
            chatId,
            media.buffer,
            media.contentType,
            info.title,
            platform
          );
      }

      if (!result?.ok) {
        throw new Error(
          result?.description ||
          "Telegram gagal mengirim foto."
        );
      }

      sent++;
    }
  }

  if (
    !info.videos.length &&
    !info.images.length &&
    info.audios.length
  ) {
    for (const audioUrl of info.audios) {
      const media =
        await fetchBuffer(
          audioUrl,
          49 * 1024 * 1024
        );

      const result =
        await sendAudio(
          chatId,
          media.buffer,
          media.contentType,
          info.title,
          platform
        );

      if (!result?.ok) {
        throw new Error(
          result?.description ||
          "Telegram gagal mengirim audio."
        );
      }

      sent++;
    }
  }

  if (!sent) {
    throw new Error(
      "Tidak ada media yang berhasil dikirim."
    );
  }

  return sent;
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
        "Instagram",
        "YouTube",
        "Facebook"
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

Kirim link video, foto, carousel, atau audio.

📌 Limit harian: ${DAILY_LIMIT} media

Bisa:
• TikTok
• Instagram
• YouTube
• Facebook

/limit untuk cek sisa limit
/help untuk bantuan`
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

1. Salin link media
2. Kirim ke bot
3. Tunggu sebentar
4. Media langsung dikirim

🎬 Video
🖼️ Foto
📚 Carousel
🎵 Audio

Platform:
• TikTok
• Instagram
• YouTube
• Facebook

/limit — cek sisa limit`
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

    if (text.startsWith("/admin ")) {
      const pin =
        text.slice(7).trim();

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
        totalDownloads += Number(
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

📥 Total Download:
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
            "Kirim link media yang valid ya 🙂"
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
📸 Instagram
▶️ YouTube
📘 Facebook`
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
${DAILY_LIMIT} media/hari

Coba lagi besok.`
        }
      );

      return res.status(200).json({
        ok: true
      });
    }

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

      return res.status(200).json({
        ok: true,
        type: info.type,
        images: info.images.length,
        videos: info.videos.length,
        audios: info.audios.length
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
`❌ Gagal mengambil media.

${error?.message || "Terjadi kesalahan."}`
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
        "Internal server error"
    });
  }
}
