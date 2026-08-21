const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

async function sendTextMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

// Download file menjadi Blob Buffer
async function getFileBlob(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
  });
  if (!res.ok) throw new Error(`Gagal unduh media (${res.status})`);
  return await res.blob();
}

// Kirim Video Tunggal via Buffer
async function sendVideo(chatId, videoUrl, title) {
  const blob = await getFileBlob(videoUrl);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("video", blob, "video.mp4");
  form.append("caption", `🎬 ${title}\n\n☁️ Cloupanz`);
  form.append("supports_streaming", "true");

  const res = await fetch(`${TELEGRAM_API}/sendVideo`, { method: "POST", body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(json.description || "Gagal kirim video");
}

// Kirim Foto Tunggal atau Album (Carousel) via Buffer
async function sendPhotos(chatId, imageUrls, title) {
  const urls = imageUrls.slice(0, 10); // Batas Telegram maks 10 foto per album

  if (urls.length === 1) {
    const blob = await getFileBlob(urls[0]);
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("photo", blob, "photo.jpg");
    form.append("caption", `🖼️ ${title}\n\n☁️ Cloupanz`);

    const res = await fetch(`${TELEGRAM_API}/sendPhoto`, { method: "POST", body: form });
    const json = await res.json();
    if (!json.ok) throw new Error(json.description || "Gagal kirim foto");
    return;
  }

  // Unduh semua foto secara paralel agar cepat
  const blobs = await Promise.all(urls.map(url => getFileBlob(url)));

  const form = new FormData();
  form.append("chat_id", String(chatId));

  const mediaGroup = blobs.map((blob, index) => {
    const attachName = `photo_${index}`;
    form.append(attachName, blob, `${attachName}.jpg`);
    return {
      type: "photo",
      media: `attach://${attachName}`,
      caption: index === 0 ? `🖼️ ${title}\n\n☁️ Cloupanz` : undefined
    };
  });

  form.append("media", JSON.stringify(mediaGroup));

  const res = await fetch(`${TELEGRAM_API}/sendMediaGroup`, { method: "POST", body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(json.description || "Gagal kirim album foto");
}

// Kirim Audio Musik via Buffer
async function sendAudio(chatId, audioUrl, title) {
  const blob = await getFileBlob(audioUrl);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("audio", blob, "audio.mp3");
  form.append("title", "Audio Musik");
  form.append("caption", `🎵 ${title}\n\n☁️ Cloupanz`);

  await fetch(`${TELEGRAM_API}/sendAudio`, { method: "POST", body: form });
}

// Ambil URL Gambar bersih dari berbagai struktur respon API
function extractImages(root) {
  const list = root?.images || root?.photos || root?.carousel || [];
  const results = [];

  const add = val => {
    if (!val) return;
    if (typeof val === "string" && val.startsWith("http")) results.push(val);
    else if (typeof val === "object") {
      const u = val.url || val.imageUrl || val.src || val.photo;
      if (typeof u === "string" && u.startsWith("http")) results.push(u);
    }
  };

  if (Array.isArray(list)) list.forEach(add);
  add(root?.image);
  add(root?.display_url);
  add(root?.thumbnail);

  return [...new Set(results)];
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
    const audioUrl = root?.audioUrl || root?.audio_url || root?.music || "";
    const images = extractImages(root);
    const isPhotoUrl = text.includes("/photo/") || text.includes("/photo") || text.includes("/p/");

    // 1. Kirim Foto / Carousel jika ada gambar atau formatnya link postingan foto
    if ((isPhotoUrl || images.length > 0) && images.length > 0) {
      await sendPhotos(chatId, images, title);
    } 
    // 2. Kirim Video jika bukan foto
    else if (videoUrl) {
      await sendVideo(chatId, videoUrl, title);
    } else {
      throw new Error("Format media tidak ditemukan.");
    }

    // 3. Sertakan Audio jika postingan foto memiliki backsound
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
