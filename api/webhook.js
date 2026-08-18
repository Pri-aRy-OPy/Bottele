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

function validMediaUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;

  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
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
    `${firestoreBase()}/users/${encodeURIComponent(String(userId))}` +
    `?key=${FIREBASE_API_KEY}`;

  const response = await fetch(url);

  if (!response.ok) return null;

  return await response.json();
}

async function saveUser(user) {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY || !user?.id) {
    return;
  }

  const id = String(user.id);
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
        stringValue: id
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
    remaining: Math.max(DAILY_LIMIT - downloads, 0),
    admin: false
  };
}

async function addDownload(user) {
  const old = await getUser(user.id);

  let downloads = Number(
    old?.fields?.downloads?.integerValue || 0
  );

  const currentDate = today();

  const lastReset =
    old?.fields?.last_reset?.stringValue || "";

  if (lastReset !== currentDate) {
    downloads = 0;
  }

  downloads++;

  const id = String(user.id);

  const data = {
    fields: {
      telegram_id: {
        stringValue: id
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

  return downloads;
}

function detectPlatform(url) {
  try {
    const host = new URL(url)
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

function addUrl(list, value) {
  if (validMediaUrl(value)) {
    list.push(value);
  }
}

function collectImages(root, data) {
  const result = [];

  const add = value => {
    if (typeof value === "string") {
      addUrl(result, value);
      return;
    }

    if (!value || typeof value !== "object") return;

    addUrl(
      result,
      value.url ||
      value.imageUrl ||
      value.image_url ||
      value.downloadUrl ||
      value.download_url ||
      value.src ||
      value.source
    );
  };

  const arrays = [
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
    root?.resources,
    root?.items,
    data?.images,
    data?.photos,
    data?.items,
    data?.media
  ];

  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;

    for (const item of arr) {
      add(item);
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

  function walk(value, depth = 0) {
    if (!value || depth > 7) return;

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
          k.includes("photo")
        )
      ) {
        add(item);
      }

      if (
        Array.isArray(item) &&
        (
          k.includes("image") ||
          k.includes("photo") ||
          k.includes("carousel") ||
          k.includes("slide") ||
          k === "media"
        )
      ) {
        for (const entry of item) {
          add(entry);
          walk(entry, depth + 1);
        }
      }

      if (
        item &&
        typeof item === "object"
      ) {
        walk(item, depth + 1);
      }
    }
  }

  walk(root);
  walk(data);

  return unique(result);
}

function extractVideoUrls(root, data) {
  const result = [];

  const candidates = [
    root?.videoUrl,
    root?.video_url,
    root?.video,
    root?.videoDownload,
    root?.video_download,
    root?.play,
    root?.playUrl,
    root?.play_url,
    root?.downloadUrl,
    root?.download_url,
    data?.videoUrl,
    data?.video_url,
    data?.video,
    data?.play,
    data?.downloadUrl,
    data?.download_url
  ];

  for (const value of candidates) {
    addUrl(result, value);
  }

  return unique(result);
}

function extractAudioUrls(root, data) {
  const result = [];

  const candidates = [
    root?.audioUrl,
    root?.audio_url,
    root?.audio,
    root?.music,
    root?.musicUrl,
    root?.music_url,
    root?.sound,
    root?.soundUrl,
    root?.sound_url,
    data?.audioUrl,
    data?.audio_url,
    data?.audio,
    data?.music,
    data?.musicUrl,
    data?.sound,
    data?.soundUrl
  ];

  for (const value of candidates) {
    addUrl(result, value);
  }

  return unique(result);
}

function walkMediaObjects(value, output, depth = 0) {
  if (!value || depth > 7) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      walkMediaObjects(item, output, depth + 1);
    }

    return;
  }

  if (typeof value !== "object") return;

  const type = String(
    value.type ||
    value.mediaType ||
    value.media_type ||
    ""
  ).toLowerCase();

  const url =
    value.url ||
    value.downloadUrl ||
    value.download_url ||
    value.src ||
    value.source ||
    "";

  if (
    validMediaUrl(url) &&
    (
      type.includes("video") ||
      type.includes("image") ||
      type.includes("photo") ||
      type.includes("audio")
    )
  ) {
    output.push({
      type:
        type.includes("video")
          ? "video"
          : type.includes("audio")
            ? "audio"
            : "image",
      url
    });
  }

  for (const [key, item] of Object.entries(value)) {
    const k = key.toLowerCase();

    if (
      k.includes("media") ||
      k.includes("carousel") ||
      k.includes("slide") ||
      k.includes("items") ||
      k.includes("images") ||
      k.includes("photos") ||
      k.includes("videos") ||
      k.includes("audios")
    ) {
      walkMediaObjects(item, output, depth + 1);
    }

    if (
      item &&
      typeof item === "object"
    ) {
      walkMediaObjects(item, output, depth + 1);
    }
  }
}

async function downloadInfo(url) {
  const apiUrl =
    `https://ahm7xmakki.com/api/alldl?url=${encodeURIComponent(url)}`;

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    55000
  );

  let response;

  try {
    response = await fetch(apiUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 Cloupanz Downloader"
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();

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
    root?.caption ||
    data?.title ||
    "Cloupanz Download";

  let videoUrls = extractVideoUrls(root, data);
  let audioUrls = extractAudioUrls(root, data);

  let images = collectImages(root, data);

  const mediaObjects = [];

  walkMediaObjects(root, mediaObjects);
  walkMediaObjects(data, mediaObjects);

  for (const item of mediaObjects) {
    if (!validMediaUrl(item.url)) continue;

    if (item.type === "video") {
      videoUrls.push(item.url);
    }

    if (item.type === "audio") {
      audioUrls.push(item.url);
    }

    if (item.type === "image") {
      images.push(item.url);
    }
  }

  videoUrls = unique(videoUrls);
  audioUrls = unique(audioUrls);
  images = unique(images);

  if (
    !videoUrls.length &&
    root?.url &&
    String(root?.type || "").toLowerCase() === "video"
  ) {
    videoUrls.push(root.url);
  }

  if (
    !audioUrls.length &&
    root?.url &&
    String(root?.type || "").toLowerCase() === "audio"
  ) {
    audioUrls.push(root.url);
  }

  if (
    !videoUrls.length &&
    !audioUrls.length &&
    !images.length
  ) {
    throw new Error(
      "Media tidak ditemukan dari API downloader."
    );
  }

  let type = "unknown";

  if (videoUrls.length && images.length) {
    type = "mixed";
  } else if (videoUrls.length) {
    type = "video";
  } else if (images.length > 1) {
    type = "carousel";
  } else if (images.length === 1) {
    type = "image";
  } else if (audioUrls.length) {
    type = "audio";
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
    videoUrl: videoUrls[0] || "",
    videoUrls,
    audioUrl: audioUrls[0] || "",
    audioUrls,
    images,
    count: images.length
  };
}

function caption(title, platform) {
  return (
    `☁️ Cloupanz\n\n` +
    `📌 ${title}\n` +
    `🌐 Sumber: ${platform}`
  );
}

async function sendVideo(
  chatId,
  url,
  title,
  platform
) {
  return telegram("sendVideo", {
    chat_id: chatId,
    video: url,
    supports_streaming: true,
    caption: `🎬 ${caption(title, platform)}`
  });
}

async function sendAudio(
  chatId,
  url,
  title,
  platform
) {
  return telegram("sendAudio", {
    chat_id: chatId,
    audio: url,
    title,
    caption: `🎵 ${caption(title, platform)}`
  });
}

async function sendPhoto(
  chatId,
  url,
  title,
  platform
) {
  return telegram("sendPhoto", {
    chat_id: chatId,
    photo: url,
    caption: `🖼️ ${caption(title, platform)}`
  });
}

async function sendPhotoGroup(
  chatId,
  images,
  title,
  platform
) {
  const chunks = [];

  for (let i = 0; i < images.length; i += 10) {
    chunks.push(images.slice(i, i + 10));
  }

  const results = [];

  for (const chunk of chunks) {
    const media = chunk.map((url, index) => ({
      type: "photo",
      media: url,
      caption:
        index === 0
          ? `🖼️ ${caption(title, platform)}`
          : undefined
    }));

    const result = await telegram(
      "sendMediaGroup",
      {
        chat_id: chatId,
        media
      }
    );

    if (!result?.ok) {
      throw new Error(
        result?.description ||
        "Telegram gagal mengirim carousel."
      );
    }

    results.push(result);
  }

  return results;
}

async function sendMedia(
  chatId,
  info,
  platform
) {
  const results = [];

  if (info.videoUrls?.length) {
    for (const video of info.videoUrls.slice(0, 3)) {
      const result = await sendVideo(
        chatId,
        video,
        info.title,
        platform
      );

      if (!result?.ok) {
        throw new Error(
          result?.description ||
          "Telegram gagal mengirim video."
        );
      }

      results.push(result);
    }
  }

  if (info.images?.length) {
    if (info.images.length === 1) {
      const result = await sendPhoto(
        chatId,
        info.images[0],
        info.title,
        platform
      );

      if (!result?.ok) {
        throw new Error(
          result?.description ||
          "Telegram gagal mengirim foto."
        );
      }

      results.push(result);
    } else {
      const group = await sendPhotoGroup(
        chatId,
        info.images,
        info.title,
        platform
      );

      results.push(...group);
    }
  }

  if (info.audioUrls?.length) {
    for (const audio of info.audioUrls.slice(0, 2)) {
      const result = await sendAudio(
        chatId,
        audio,
        info.title,
        platform
      );

      if (!result?.ok) {
        continue;
      }

      results.push(result);
    }
  }

  if (!results.length) {
    throw new Error(
      "Tidak ada media yang berhasil dikirim."
    );
  }

  return results;
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
    `${firestoreBase()}/config/bot?key=${FIREBASE_API_KEY}`;

  const check = await fetch(configUrl);

  if (check.ok) {
    const config = await check.json();

    const existingAdmin =
      config?.fields?.admin_id?.stringValue;

    if (existingAdmin) {
      if (existingAdmin === String(user.id)) {
        return {
          ok: true,
          already: true
        };
      }

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

  const saved = await fetch(configUrl, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(configData)
  });

  if (!saved.ok) {
    return {
      ok: false,
      message: "Gagal menyimpan admin."
    };
  }

  const userId = String(user.id);

  const old = await getUser(userId);

  const userData = {
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

  await fetch(
    `${firestoreBase()}/users/${encodeURIComponent(userId)}?key=${FIREBASE_API_KEY}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(userData)
    }
  );

  return {
    ok: true
  };
}

export default async function handler(req, res) {
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
        error: "TELEGRAM_TOKEN belum dipasang."
      });
    }

    const update = req.body || {};
    const message = update.message;

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
      await telegram("sendMessage", {
        chat_id: chatId,
        text:
`Halo ${user?.first_name || "kak"} 👋

☁️ Cloupanz Downloader

Kirim link TikTok atau Instagram.

Bisa mengambil:
🎬 Video
🖼️ Foto
🖼️ Carousel
🎵 Audio

📌 Limit harian: ${DAILY_LIMIT}

/help
/limit`
      });

      return res.status(200).json({
        ok: true
      });
    }

    if (text === "/help") {
      await telegram("sendMessage", {
        chat_id: chatId,
        text:
`📖 Cara pakai

1. Salin link TikTok atau Instagram
2. Kirim ke bot
3. Tunggu sebentar
4. Media dikirim otomatis

Yang didukung:
🎬 Video
🖼️ Foto
🖼️ Carousel
🎵 Audio

Untuk melihat limit:
/limit`
      });

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

      await telegram("sendMessage", {
        chat_id: chatId,
        text: status.admin
          ? `👑 Admin Cloupanz

Limit download:
∞ Tanpa batas`
          :
`📊 Limit kamu

Hari ini:
${status.downloads}/${DAILY_LIMIT}

Sisa:
${status.remaining} download`
      });

      return res.status(200).json({
        ok: true
      });
    }

    if (text.startsWith("/admin ")) {
      const pin =
        text.slice(7).trim();

      const result =
        await claimAdmin({
          ...user,
          __adminPin: pin
        });

      await telegram("sendMessage", {
        chat_id: chatId,
        text: result.ok
          ? `👑 Admin berhasil diaktifkan.

Cloupanz Control Panel aktif.

Limit download:
∞ Tanpa batas`
          : `❌ ${result.message}`
      });

      return res.status(200).json({
        ok: true
      });
    }

    const admin =
      await isAdmin(user.id);

    if (text === "/stats") {
      if (!admin) {
        await telegram("sendMessage", {
          chat_id: chatId,
          text: "❌ Perintah khusus admin."
        });

        return res.status(200).json({
          ok: true
        });
      }

      const url =
        `${firestoreBase()}/users?key=${FIREBASE_API_KEY}`;

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

      await telegram("sendMessage", {
        chat_id: chatId,
        text:
`📊 Cloupanz Stats

👥 Users:
${users.length}

📥 Download:
${totalDownloads}

👑 Admin:
Aktif`
      });

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
      await telegram("sendMessage", {
        chat_id: chatId,
        text:
          "Kirim link TikTok atau Instagram ya 🙂"
      });

      return res.status(200).json({
        ok: true
      });
    }

    const platform =
      detectPlatform(text);

    if (!platform) {
      await telegram("sendMessage", {
        chat_id: chatId,
        text:
`❌ Platform belum didukung.

Saat ini:
🎵 TikTok
📸 Instagram`
      });

      return res.status(200).json({
        ok: true
      });
    }

    const status =
      await getDownloadStatus(user.id);

    if (
      !status.admin &&
      status.remaining <= 0
    ) {
      await telegram("sendMessage", {
        chat_id: chatId,
        text:
`❌ Limit hari ini sudah habis.

Batas:
${DAILY_LIMIT} download/hari

Coba lagi besok.`
      });

      return res.status(200).json({
        ok: true
      });
    }

    const processing =
      await telegram("sendMessage", {
        chat_id: chatId,
        text:
`⏳ Tunggu sebentar...

🔎 Mengambil media ${platform}...`
      });

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
        videos: info.videoUrls?.length || 0,
        images: info.images?.length || 0,
        audios: info.audioUrls?.length || 0
      });
    } catch (error) {
      console.error(
        "DOWNLOAD ERROR:",
        error
      );

      await telegram("sendMessage", {
        chat_id: chatId,
        text:
          `❌ Gagal mengambil media.\n\n` +
          `${error?.message || "Terjadi kesalahan."}`
      });

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
