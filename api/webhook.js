const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

async function sendTextMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

// Download file media menjadi Buffer Blob
async function getFileBlob(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
  });
  if (!res.ok) throw new Error(`Gagal mengunduh media (${res.status})`);
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

// Kirim Foto Tunggal atau Album (Carousel) via Buffer
async function sendPhotos(chatId, imageUrls, title) {
  // Ambil maksimal 10 foto pertama sesuai batas album Telegram
  const urls = imageUrls.slice(0, 10);

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

  // Unduh seluruh foto secara paralel (cepat & hemat waktu serverless)
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

// Kirim Audio Musik jika ada
async function sendAudio(chatId, audioUrl, title) {
  const blob = await getFileBlob(audioUrl);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("audio", blob, "audio.mp3");
  form.append("title", "Audio Musik");
  form.append("caption", `🎵 Musik: ${title}\n\n☁️ Cloupanz`);

  await fetch(`${TELEGRAM_API}/sendAudio`, { method: "POST", body: form });
}

// Ekstraksi seluruh URL gambar secara rekursif dari seluruh struktur JSON API
function extractAllImages(data) {
  const urls = new Set();

  function walk(node, depth = 0) {
    if (!node || depth > 8) return;

    if (typeof node === "string") {
      const lower = node.toLowerCase();
      if (
        (node.startsWith("http://") || node.startsWith("https://")) &&
        (lower.includes(".jpg") ||
          lower.includes(".jpeg") ||
          lower.includes(".png") ||
          lower.includes(".webp") ||
          lower.includes("cdninstagram") ||
          lower.includes("tiktokcdn") ||
          lower.includes("image"))
      ) {
        urls.add(node);
      }
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }

    if (typeof node === "object") {
      for (const key of Object.keys(node)) {
        const k = key.toLowerCase();
        // Telusuri kunci objek yang biasanya menyimpan gambar/slide
        if (
          k.includes("image") ||
          k.includes("photo") ||
          k.includes("carousel") ||
          k.includes("slide") ||
          k.includes("display") ||
          k.includes("url") ||
          k.includes("src") ||
          k.includes("media") ||
          k.includes("item")
        ) {
          walk(node[key], depth + 1);
        }
      }
    }
  }

  walk(data);
  return Array.from(urls);
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

    const fullData = await fetchDownloader(text);
    const root = fullData?.data?.mediaInfo || fullData?.mediaInfo || fullData?.result || fullData?.data || fullData;

    const title = root?.title || fullData?.title || "Cloupanz Media";
    const videoUrl = root?.videoUrl || root?.video_url || root?.url || "";
    const audioUrl = root?.audioUrl || root?.audio_url || root?.music || "";
    const isPhotoUrl = text.includes("/photo/") || text.includes("/photo") || text.includes("/p/");

    // Ambil seluruh foto yang ada di postingan
    const images = extractAllImages(fullData);

    // 1. Jika link berupa postingan foto atau ditemukan gambar
    if (isPhotoUrl || images.length > 0) {
      if (images.length > 0) {
        await sendPhotos(chatId, images, title);
      } else {
        throw new Error("Foto tidak ditemukan pada postingan ini.");
      }
    } 
    // 2. Jika postingan adalah video
    else if (videoUrl) {
      await sendVideo(chatId, videoUrl, title);
    } else {
      throw new Error("Format media tidak didukung atau tidak ditemukan.");
    }

    // 3. Sertakan audio jika ada (misal pada slide TikTok)
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
