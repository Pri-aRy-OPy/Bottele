const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

async function sendTextMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

// Unduh file menjadi Buffer Blob
async function getFileBlob(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
  });
  if (!res.ok) throw new Error(`Gagal unduh file (${res.status})`);
  return await res.blob();
}

// Kirim Video via Buffer
async function sendVideo(chatId, videoUrl, title) {
  const blob = await getFileBlob(videoUrl);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("video", blob, "video.mp4");
  form.append("caption", `🎬 ${title}\n\n☁️ Cloupanz`);
  form.append("supports_streaming", "true");

  const res = await fetch(`${TELEGRAM_API}/sendVideo`, { method: "POST", body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(json.description || "Gagal mengirim video");
}

// Kirim Foto Tunggal atau Album via Buffer
async function sendPhotos(chatId, imageUrls, title) {
  const urls = imageUrls.slice(0, 10); // Batas maksimal album Telegram

  if (urls.length === 1) {
    const blob = await getFileBlob(urls[0]);
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("photo", blob, "photo.jpg");
    form.append("caption", `🖼️ ${title}\n\n☁️ Cloupanz`);

    const res = await fetch(`${TELEGRAM_API}/sendPhoto`, { method: "POST", body: form });
    const json = await res.json();
    if (!json.ok) throw new Error(json.description || "Gagal mengirim foto");
    return;
  }

  // Unduh seluruh foto bersamaan
  const blobs = await Promise.all(urls.map(url => getFileBlob(url)));

  const form = new FormData();
  form.append("chat_id", String(chatId));

  const mediaGroup = blobs.map((blob, index) => {
    const attachName = `photo_${index}`;
    form.append(attachName, blob, `${attachName}.jpg`);
    return {
      type: "photo",
      media: `attach://${attachName}`,
      caption: index === 0 ? `🖼️ ${title} (${urls.length} foto)\n\n☁️ Cloupanz` : undefined
    };
  });

  form.append("media", JSON.stringify(mediaGroup));

  const res = await fetch(`${TELEGRAM_API}/sendMediaGroup`, { method: "POST", body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(json.description || "Gagal mengirim album foto");
}

// Kirim Audio jika ada musik latar
async function sendAudio(chatId, audioUrl, title) {
  const blob = await getFileBlob(audioUrl);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("audio", blob, "audio.mp3");
  form.append("title", "Audio Musik");
  form.append("caption", `🎵 Musik: ${title}\n\n☁️ Cloupanz`);

  await fetch(`${TELEGRAM_API}/sendAudio`, { method: "POST", body: form });
}

// Ekstraksi URL Gambar secara langsung dan aman
function getMediaImages(root, rawData) {
  const images = [];

  const add = val => {
    if (!val) return;
    if (typeof val === "string" && val.startsWith("http")) {
      if (!images.includes(val)) images.push(val);
    } else if (typeof val === "object") {
      const u = val.url || val.imageUrl || val.src || val.photo || val.display_url;
      if (typeof u === "string" && u.startsWith("http") && !images.includes(u)) {
        images.push(u);
      }
    }
  };

  const sources = [
    root?.images,
    root?.photos,
    root?.carousel,
    root?.carouselMedia,
    root?.slides,
    rawData?.data?.images,
    rawData?.images
  ];

  for (const list of sources) {
    if (Array.isArray(list)) list.forEach(add);
  }

  add(root?.image);
  add(root?.display_url);
  add(root?.thumbnail);
  add(root?.thumbnailUrl);

  return images;
}

async function fetchDownloader(url) {
  const api = `https://ahm7xmakki.com/api/alldl?url=` + encodeURIComponent(url);
  const response = await fetch(api, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }
  });
  const text = await response.text();
  const data = JSON.parse(text);
  if (!response.ok) throw new Error(data?.message || "Gagal mengambil data media.");
  return data;
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
      await sendTextMessage(chatId, "👋 Kirim link TikTok atau Instagram untuk mengunduh media.");
      return res.status(200).json({ ok: true });
    }

    const isSupported = text.includes("tiktok.com") || text.includes("instagram.com") || text.includes("instagr.am");
    if (!isSupported) {
      await sendTextMessage(chatId, "❌ Kirim link TikTok atau Instagram yang valid.");
      return res.status(200).json({ ok: true });
    }

    await sendTextMessage(chatId, "⏳ Mengunduh dan memproses media...");

    const rawData = await fetchDownloader(text);
    const root = rawData?.data?.mediaInfo || rawData?.mediaInfo || rawData?.data || rawData?.result || rawData;

    const title = root?.title || rawData?.title || "Cloupanz Media";
    const videoUrl = root?.videoUrl || root?.video_url || root?.url || "";
    const audioUrl = root?.audioUrl || root?.audio_url || root?.music || "";
    const isPhotoUrl = text.includes("/photo/") || text.includes("/photo") || text.includes("/p/");

    const images = getMediaImages(root, rawData);

    // 1. Postingan Foto / Carousel
    if ((isPhotoUrl || images.length > 0) && images.length > 0) {
      await sendPhotos(chatId, images, title);
    } 
    // 2. Postingan Video
    else if (videoUrl) {
      await sendVideo(chatId, videoUrl, title);
    } else {
      throw new Error("Media tidak ditemukan.");
    }

    // 3. Sertakan musik jika ada pada postingan foto
    if (audioUrl && images.length > 0) {
      await sendAudio(chatId, audioUrl, title).catch(() => {});
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("WEBHOOK ERROR:", error);
    if (req.body?.message?.chat?.id) {
      await sendTextMessage(req.body.message.chat.id, `❌ Gagal mengambil media: ${error.message}`).catch(() => {});
    }
    return res.status(200).json({ ok: false, error: error.message });
  }
}
