export const config = {
  maxDuration: 30 // Mencegah Vercel timeout saat memproses file banyak
};

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

async function sendTextMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  }).catch(() => {});
}

// Unduh file media ke Buffer
async function getFileBlob(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
  });
  if (!res.ok) throw new Error(`Gagal unduh sumber file (${res.status})`);
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
  if (!json.ok) throw new Error(json.description || "Gagal kirim video");
}

// Kirim Foto Tunggal atau Album (Carousel) via Buffer
async function sendPhotos(chatId, imageUrls, title) {
  const urls = imageUrls.slice(0, 10);

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

  // Unduh semua foto secara paralel
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
  if (!json.ok) throw new Error(json.description || "Gagal kirim album foto");
}

// Kirim Audio
async function sendAudio(chatId, audioUrl, title) {
  const blob = await getFileBlob(audioUrl);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("audio", blob, "audio.mp3");
  form.append("title", "Audio Musik");
  form.append("caption", `🎵 Musik: ${title}\n\n☁️ Cloupanz`);

  await fetch(`${TELEGRAM_API}/sendAudio`, { method: "POST", body: form });
}

// 1. Parser Khusus TikTok (TikWM)
async function downloadTikTok(url) {
  const res = await fetch("https://www.tikwm.com/api/?url=" + encodeURIComponent(url), {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }
  });
  const json = await res.json();
  if (json.code !== 0 || !json.data) {
    throw new Error(json.msg || "Gagal mengambil data TikTok.");
  }

  const d = json.data;
  const isSlide = Array.isArray(d.images) && d.images.length > 0;

  return {
    type: isSlide ? "photo" : "video",
    title: d.title || "TikTok Media",
    images: isSlide ? d.images : [],
    videoUrl: isSlide ? "" : (d.play || d.wmplay || ""),
    audioUrl: d.music || ""
  };
}

// 2. Parser Khusus Instagram (Pembersihan URL & Deteksi Jenis Media)
async function downloadInstagram(rawUrl) {
  // Bersihkan query tracking (?igsh=...)
  const cleanUrl = rawUrl.split("?")[0];
  const api = `https://ahm7xmakki.com/api/alldl?url=` + encodeURIComponent(cleanUrl);

  const res = await fetch(api, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || "Gagal mengambil data Instagram.");

  const root = data?.data?.mediaInfo || data?.mediaInfo || data?.data || data?.result || data;
  const isReels = cleanUrl.includes("/reel/") || cleanUrl.includes("/reels/");

  const videoUrl = root?.videoUrl || root?.video_url || root?.url || "";
  const images = [];

  const addImg = val => {
    if (!val) return;
    if (typeof val === "string" && val.startsWith("http")) {
      if (!images.includes(val)) images.push(val);
    } else if (typeof val === "object") {
      const u = val.url || val.imageUrl || val.src || val.display_url;
      if (typeof u === "string" && u.startsWith("http") && !images.includes(u)) {
        images.push(u);
      }
    }
  };

  const carousels = root?.carousel || root?.carouselMedia || root?.images || root?.photos || root?.medias;
  if (Array.isArray(carousels)) {
    carousels.forEach(addImg);
  }

  // Jika bukan video Reels dan tidak ada list carousel, ambil single photo
  if (!isReels && !videoUrl && images.length === 0) {
    addImg(root?.image);
    addImg(root?.display_url);
    addImg(root?.thumbnail);
  }

  const isVideo = Boolean(videoUrl) || isReels;

  return {
    type: isVideo ? "video" : "photo",
    title: root?.title || data?.title || "Instagram Media",
    images: isVideo ? [] : images,
    videoUrl: isVideo ? videoUrl : "",
    audioUrl: root?.audioUrl || root?.audio_url || ""
  };
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

    const isTikTok = text.includes("tiktok.com");
    const isInstagram = text.includes("instagram.com") || text.includes("instagr.am");

    if (!isTikTok && !isInstagram) {
      await sendTextMessage(chatId, "❌ Kirim link TikTok atau Instagram yang valid.");
      return res.status(200).json({ ok: true });
    }

    await sendTextMessage(chatId, "⏳ Mengunduh dan memproses media...");

    const media = isTikTok ? await downloadTikTok(text) : await downloadInstagram(text);

    // Kirim Foto / Carousel
    if (media.type === "photo" && media.images.length > 0) {
      await sendPhotos(chatId, media.images, media.title);

      if (media.audioUrl) {
        await sendAudio(chatId, media.audioUrl, media.title).catch(() => {});
      }
    } 
    // Kirim Video
    else if (media.type === "video" && media.videoUrl) {
      await sendVideo(chatId, media.videoUrl, media.title);
    } else {
      throw new Error("Konten tidak ditemukan atau akun di-private.");
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("WEBHOOK ERROR:", error);
    if (req.body?.message?.chat?.id) {
      await sendTextMessage(req.body.message.chat.id, `❌ Gagal mengambil media: ${error.message}`);
    }
    return res.status(200).json({ ok: false, error: error.message });
  }
}
