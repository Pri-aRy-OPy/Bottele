import crypto from "node:crypto";
import { Readable } from "node:stream";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const ADMIN_PIN = process.env.ADMIN_PIN;
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 5);

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function firestoreBase() {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

function userDoc(id) {
  return String(id);
}

async function telegram(method, data) {
  const r = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });

  const json = await r.json();

  if (!json?.ok) {
    throw new Error(json?.description || `Telegram ${method} gagal`);
  }

  return json;
}

async function getUser(id) {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY) return null;

  const url =
    `${firestoreBase()}/users/${encodeURIComponent(userDoc(id))}` +
    `?key=${FIREBASE_API_KEY}`;

  const r = await fetch(url);

  if (!r.ok) return null;

  return await r.json();
}

async function saveUser(user) {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY || !user?.id) return;

  const id = userDoc(user.id);
  const old = await getUser(id);
  const date = today();

  let downloads = Number(
    old?.fields?.downloads?.integerValue || 0
  );

  let lastReset =
    old?.fields?.last_reset?.stringValue || "";

  if (lastReset !== date) {
    downloads = 0;
    lastReset = date;
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

async function isAdmin(id) {
  const user = await getUser(id);

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

  if (user.__adminPin !== ADMIN_PIN) {
    return {
      ok: false,
      message: "PIN salah."
    };
  }

  const configUrl =
    `${firestoreBase()}/config/bot?key=${FIREBASE_API_KEY}`;

  const check = await fetch(configUrl);

  if (check.ok) {
    const config = await check.json();
    const existing =
      config?.fields?.admin_id?.stringValue;

    if (
      existing &&
      existing !== String(user.id)
    ) {
      return {
        ok: false,
        message: "Admin sudah terdaftar."
      };
    }
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

  await fetch(userUrl, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
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
    })
  });

  return {
    ok: true
  };
}

async function getDownloadStatus(id) {
  const user = await getUser(id);

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

  let downloads = Number(
    user?.fields?.downloads?.integerValue || 0
  );

  const lastReset =
    user?.fields?.last_reset?.stringValue || "";

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
  const date = today();

  let downloads = Number(
    old?.fields?.downloads?.integerValue || 0
  );

  const lastReset =
    old?.fields?.last_reset?.stringValue || "";

  if (lastReset !== date) {
    downloads = 0;
  }

  downloads++;

  const url =
    `${firestoreBase()}/users/${encodeURIComponent(String(user.id))}` +
    `?key=${FIREBASE_API_KEY}`;

  await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
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
          stringValue: date
        },
        is_admin: {
          booleanValue:
            old?.fields?.is_admin?.booleanValue === true
        },
        last_seen: {
          timestampValue: new Date().toISOString()
        }
      }
    })
  });

  return downloads;
}

function detectPlatform(value) {
  try {
    const host = new URL(value)
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

function validUrl(value) {
  try {
    const u = new URL(value);

    return (
      u.protocol === "https:" ||
      u.protocol === "http:"
    );
  } catch {
    return false;
  }
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);

    return (
      u.protocol === "https:" ||
      u.protocol === "http:"
    );
  } catch {
    return false;
  }
}

function signMediaUrl(url, time) {
  return crypto
    .createHmac("sha256", TELEGRAM_TOKEN || "")
    .update(`${time}:${url}`)
    .digest("hex");
}

function proxyUrl(url) {
  const time = Math.floor(Date.now() / 1000);
  const signature = signMediaUrl(url, time);

  return (
    `https://${process.env.VERCEL_URL || "cloupanz.vercel.app"}` +
    `/api/webhook?media=${encodeURIComponent(url)}` +
    `&t=${time}&s=${signature}`
  );
}

async function proxyMedia(req, res) {
  const target =
    req.query?.media ||
    req.query?.url ||
    "";

  const time =
    Number(req.query?.t || 0);

  const signature =
    req.query?.s || "";

  if (!target || !time || !signature) {
    return res.status(400).send("Invalid media request");
  }

  if (!isHttpUrl(target)) {
    return res.status(400).send("Invalid media URL");
  }

  const age =
    Math.floor(Date.now() / 1000) - time;

  if (age < -30 || age > 900) {
    return res.status(403).send("Media URL expired");
  }

  const expected =
    signMediaUrl(target, time);

  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expected, "hex");

  // Mencegah crash jika panjang buffer berbeda
  if (
    sigBuf.length !== expBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expBuf)
  ) {
    return res.status(403).send("Invalid signature");
  }

  try {
    const response = await fetch(target, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 Cloupanz Media Proxy",
        Accept: "*/*"
      }
    });

    if (!response.ok || !response.body) {
      return res
        .status(502)
        .send("Media source unavailable");
    }

    const contentType =
      response.headers.get("content-type") ||
      "application/octet-stream";

    const contentLength =
      response.headers.get("content-length");

    res.setHeader(
      "Content-Type",
      contentType
    );

    if (contentLength) {
      res.setHeader(
        "Content-Length",
        contentLength
      );
    }

    res.setHeader(
      "Cache-Control",
      "public, max-age=300"
    );

    const stream =
      Readable.fromWeb(response.body);

    stream.on("error", () => {
      if (!res.headersSent) {
        res.status(502).end();
      } else {
        res.end();
      }
    });

    stream.pipe(res);
  } catch {
    return res
      .status(502)
      .send("Failed to proxy media");
  }
}

async function fetchDownloader(url) {
  const api =
    `https://ahm7xmakki.com/api/alldl?url=` +
    encodeURIComponent(url);

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      25000
    );

  try {
    const response = await fetch(api, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 Cloupanz Downloader"
      },
      signal: controller.signal
    });

    const text =
      await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        "Downloader API mengirim response tidak valid."
      );
    }

    if (!response.ok) {
      throw new Error(
        data?.message ||
        data?.error ||
        `Downloader API ${response.status}`
      );
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function collectImages(root, data) {
  const images = [];

  const add = value => {
    if (!isHttpUrl(value)) return;

    images.push(String(value));
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
      item.source ||
      item.photo
    );
  };

  const sources = [
    root?.images,
    root?.imageUrls,
    root?.image_urls,
    root?.photos,
    root?.photoUrls,
    root?.photo_urls,
    root?.carousel,
    root?.carouselMedia,
    root?.carousel_media,
    root?.slides,
    root?.items,
    root?.media,
    root?.resources,
    data?.images,
    data?.photos,
    data?.items,
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
  add(data?.image_url);

  const walk = (value, depth = 0) => {
    if (!value || depth > 6) return;

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item, depth + 1);
      }
      return;
    }

    if (typeof value !== "object") return;

    for (const [key, item] of Object.entries(value)) {
      const k = key.toLowerCase();

      if (
        typeof item === "string" &&
        (
          k.includes("image") ||
          k.includes("photo") ||
          k === "src"
        )
      ) {
        add(item);
      }

      if (Array.isArray(item)) {
        if (
          k.includes("image") ||
          k.includes("photo") ||
          k.includes("carousel") ||
          k.includes("slide") ||
          k.includes("media")
        ) {
          for (const entry of item) {
            addObject(entry);
          }
        }
      }

      if (
        item &&
        typeof item === "object"
      ) {
        walk(item, depth + 1);
      }
    }
  };

  walk(root);
  walk(data);

  return [
    ...new Set(images)
  ];
}

function firstUrl(...values) {
  for (const value of values) {
    if (isHttpUrl(value)) {
      return String(value);
    }
  }

  return "";
}

function detectMediaType(root, data, videoUrl, audioUrl, images) {
  const explicit = String(
    root?.type ||
    root?.mediaType ||
    root?.media_type ||
    data?.type ||
    data?.mediaType ||
    data?.media_type ||
    ""
  ).toLowerCase();

  if (
    explicit.includes("video") &&
    videoUrl
  ) {
    return "video";
  }

  if (
    (
      explicit.includes("image") ||
      explicit.includes("photo") ||
      explicit.includes("carousel")
    ) &&
    images.length
  ) {
    return images.length > 1
      ? "carousel"
      : "image";
  }

  if (videoUrl) {
    return "video";
  }

  if (images.length) {
    return images.length > 1
      ? "carousel"
      : "image";
  }

  if (audioUrl) {
    return "audio";
  }

  return "unknown";
}

async function downloadInfo(url) {
  const data =
    await fetchDownloader(url);

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

  let videoUrl = firstUrl(
    root?.videoUrl,
    root?.video_url,
    root?.video,
    root?.downloadVideo,
    root?.download_video
  );

  let audioUrl = firstUrl(
    root?.audioUrl,
    root?.audio_url,
    root?.audio,
    root?.musicUrl,
    root?.music_url,
    root?.music
  );

  if (
    !videoUrl &&
    root?.url &&
    String(root?.type || "")
      .toLowerCase()
      .includes("video")
  ) {
    videoUrl = root.url;
  }

  if (
    !audioUrl &&
    root?.url &&
    String(root?.type || "")
      .toLowerCase()
      .includes("audio")
  ) {
    audioUrl = root.url;
  }

  const images =
    collectImages(root, data);

  const type =
    detectMediaType(
      root,
      data,
      videoUrl,
      audioUrl,
      images
    );

  if (
    type === "video" &&
    !videoUrl
  ) {
    throw new Error(
      "Video tidak ditemukan."
    );
  }

  if (
    (
      type === "image" ||
      type === "carousel"
    ) &&
    !images.length
  ) {
    throw new Error(
      "Foto tidak ditemukan."
    );
  }

  if (
    type === "audio" &&
    !audioUrl
  ) {
    throw new Error(
      "Audio tidak ditemukan."
    );
  }

  return {
    type,
    title,
    thumbnail:
      root?.thumbnail ||
      root?.thumbnailUrl ||
      root?.thumbnail_url ||
      data?.thumbnail ||
      "",
    videoUrl,
    audioUrl,
    images
  };
}

async function sendVideo(
  chatId,
  info,
  platform
) {
  const url =
    proxyUrl(info.videoUrl);

  return telegram(
    "sendVideo",
    {
      chat_id: chatId,
      video: url,
      supports_streaming: true,
      caption:
        `🎬 ${info.title}\n\n` +
        `Sumber: ${platform}\n` +
        `☁️ Cloupanz`
    }
  );
}

async function sendAudio(
  chatId,
  info,
  platform
) {
  const url =
    proxyUrl(info.audioUrl);

  return telegram(
    "sendAudio",
    {
      chat_id: chatId,
      audio: url,
      title: info.title,
      caption:
        `🎵 ${info.title}\n\n` +
        `Sumber: ${platform}\n` +
        `☁️ Cloupanz`
    }
  );
}

async function sendPhoto(
  chatId,
  url,
  title,
  platform
) {
  return telegram(
    "sendPhoto",
    {
      chat_id: chatId,
      photo: proxyUrl(url),
      caption:
        `🖼️ ${title}\n\n` +
        `Sumber: ${platform}\n` +
        `☁️ Cloupanz`
    }
  );
}

async function sendPhotos(
  chatId,
  images,
  title,
  platform
) {
  const groups = [];

  for (
    let i = 0;
    i < images.length;
    i += 10
  ) {
    groups.push(
      images.slice(i, i + 10)
    );
  }

  for (const group of groups) {
    const media = group.map(
      (url, index) => ({
        type: "photo",
        media: proxyUrl(url),
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

    if (!result?.ok) {
      throw new Error(
        result?.description ||
        "Telegram gagal mengirim foto."
      );
    }
  }
}

async function sendMedia(
  chatId,
  info,
  platform
) {
  if (info.type === "video") {
    return sendVideo(
      chatId,
      info,
      platform
    );
  }

  if (info.type === "image") {
    await sendPhoto(
      chatId,
      info.images[0],
      info.title,
      platform
    );

    if (info.audioUrl) {
      await sendAudio(
        chatId,
        info,
        platform
      );
    }

    return;
  }

  if (info.type === "carousel") {
    await sendPhotos(
      chatId,
      info.images,
      info.title,
      platform
    );

    if (info.audioUrl) {
      await sendAudio(
        chatId,
        info,
        platform
      );
    }

    return;
  }

  if (info.type === "audio") {
    return sendAudio(
      chatId,
      info,
      platform
    );
  }

  throw new Error(
    "Jenis media tidak didukung."
  );
}

async function sendStart(chatId, user) {
  return telegram(
    "sendMessage",
    {
      chat_id: chatId,
      text:
`Halo ${user?.first_name || "kak"} 👋

Kirim link TikTok atau Instagram.

Cloupanz akan menentukan media aslinya:

🎬 Video → video saja
🖼️ Foto → foto saja
🖼️ Carousel → semua foto
🎵 Audio → audio

Kalau foto TikTok memiliki musik,
foto tetap dikirim dan audionya ikut.

📌 Limit: ${DAILY_LIMIT}/hari

/limit untuk cek limit
/help untuk bantuan`
    }
  );
}

async function sendHelp(chatId) {
  return telegram(
    "sendMessage",
    {
      chat_id: chatId,
      text:
`📖 Cara menggunakan Cloupanz

1. Kirim link TikTok atau Instagram
2. Tunggu proses
3. Bot menentukan jenis media
4. Media dikirim sesuai jenis aslinya

🎬 Video
🖼️ Foto
🖼️ Carousel
🎵 Audio

Video tidak akan dikirim sebagai foto.
Foto tidak akan dikirim sebagai video.

/limit
/me
/stats`
    }
  );
}

async function sendLimit(
  chatId,
  userId
) {
  const status =
    await getDownloadStatus(userId);

  return telegram(
    "sendMessage",
    {
      chat_id: chatId,
      text: status.admin
        ? `👑 Admin Cloupanz

Limit:
∞ Tanpa batas`
        :
`📊 Limit Cloupanz

Hari ini:
${status.downloads}/${DAILY_LIMIT}

Sisa:
${status.remaining} download`
    }
  );
}

async function sendStats(
  chatId,
  admin
) {
  if (!admin) {
    return telegram(
      "sendMessage",
      {
        chat_id: chatId,
        text:
          "❌ Perintah khusus admin."
      }
    );
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

  return telegram(
    "sendMessage",
    {
      chat_id: chatId,
      text:
`📊 Cloupanz Stats

👥 Users:
${users.length}

📥 Download:
${totalDownloads}

👑 Admin:
Aktif`
    }
  );
}

export default async function handler(
  req,
  res
) {
  if (
    req.method === "GET" &&
    req.query?.media
  ) {
    if (!TELEGRAM_TOKEN) {
      return res
        .status(500)
        .send("Telegram token missing");
    }

    return proxyMedia(
      req,
      res
    );
  }

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

    const update =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    const message =
      update?.message;

    if (!message?.chat?.id) {
      return res.status(200).json({
        ok: true
      });
    }

    const chatId =
      message.chat.id;

    const user =
      message.from;

    const text =
      message.text?.trim() || "";

    await saveUser(user);

    if (
      text === "/start" ||
      text.startsWith("/start ")
    ) {
      await sendStart(
        chatId,
        user
      );

      return res.status(200).json({
        ok: true
      });
    }

    if (text === "/help") {
      await sendHelp(chatId);

      return res.status(200).json({
        ok: true
      });
    }

    if (
      text === "/limit" ||
      text === "/me"
    ) {
      await sendLimit(
        chatId,
        user.id
      );

      return res.status(200).json({
        ok: true
      });
    }

    if (
      text.startsWith("/admin ")
    ) {
      const pin =
        text.slice(7).trim();

      const result =
        await claimAdmin({
          ...user,
          __adminPin: pin
        });

      await telegram(
        "sendMessage",
        {
          chat_id: chatId,
          text: result.ok
            ? "👑 Admin berhasil diaktifkan.\n\nAkses admin tanpa limit."
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
      await sendStats(
        chatId,
        admin
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

    if (!validUrl(text)) {
      await telegram(
        "sendMessage",
        {
          chat_id: chatId,
          text:
            "❌ Kirim link TikTok atau Instagram."
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
`❌ Platform belum didukung.

Gunakan:
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
`❌ Limit hari ini habis.

Batas:
${DAILY_LIMIT} download/hari`
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

      if (
        processing?.result?.message_id
      ) {
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
        count:
          info.type === "video"
            ? 1
            : info.type === "audio"
              ? 1
              : info.images.length,
        hasAudio:
          Boolean(info.audioUrl)
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
        "Webhook error."
    });
  }
  }
