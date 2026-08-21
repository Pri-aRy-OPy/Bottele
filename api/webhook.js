export const config = {
  maxDuration: 30
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

async function getFileBlob(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
  });
  if (!res.ok) throw new Error(`Gagal unduh sumber file (${res.status})`);
  return await res.blob();
}

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

async function sendPhotos(chatId, imageUrls, title) {
  const urls = imageUrls.slice(0, 10); // Batas album Telegram

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

async function sendAudio(chatId, audioUrl, title) {
  const blob = await getFileBlob(audioUrl);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("audio", blob, "audio.mp3");
  form.append("title", "Audio Musik");
  form.append("caption", `🎵 Musik: ${title}\n\n☁️ Cloupanz`);

  await fetch(`${TELEGRAM_API}/sendAudio`, { method: "POST", body: form });
}

// Parser TikTok (TikWM)
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

// Parser Helper untuk Ekstraksi Semua Media Instagram
function parseIgMedia(json) {
  const images = [];
  const videos = [];

  const checkAndAdd = item => {
    if (!item) return;
    if (typeof item === "string" && item.startsWith("http")) {
      const lower = item.toLowerCase();
      if (lower.includes(".mp4") || lower.includes("video_dash") || lower.includes("/v/")) {
        if (!videos.includes(item)) videos.push(item);
      } else {
        if (!images.includes(item)) images.push(item);
      }
      return;
    }
    if (typeof item === "object") {
      const target = item.url || item.download_url || item.display_url || item.imageUrl || item.image_url || item.video_url || item.src;
      if (typeof target === "string" && target.startsWith("http")) {
        const isVid = item.type === "video" || target.includes(".mp4");
        if (isVid) {
          if (!videos.includes(target)) videos.push(target);
        } else {
          if (!images.includes(target)) images.push(target);
        }
      }
    }
  };

  const root = json?.data?.mediaInfo || json?.mediaInfo || json?.data || json?.result || json;

  const containers = [
    root?.carousel,
    root?.carouselMedia,
    root?.carousel_media,
    root?.medias,
    root?.media,
    root?.images,
    root?.photos,
    root?.items,
    root?.slides,
    Array.isArray(root) ? root : null,
    Array.isArray(json?.data) ? json.data : null,
    Array.isArray(json?.result) ? json.result : null
  ];

  for (const arr of containers) {
    if (Array.isArray(arr) && arr.length > 0) {
      arr.forEach(checkAndAdd);
    }
  }

  if (images.length === 0 && videos.length === 0) {
    checkAndAdd(root?.videoUrl || root?.video_url);
    checkAndAdd(root?.image || root?.display_url || root?.thumbnail || root?.url);
  }

  return {
    images,
    videos,
    title: root?.title || json?.title || "Instagram Media"
  };
}

// Downloader Instagram dengan Sistem Fallback Multi-API
async function downloadInstagram(rawUrl) {
  const cleanUrl = rawUrl.split("?")[0];
  const isReels = cleanUrl.includes("/reel/") || cleanUrl.includes("/reels/");

  // 1. Coba Engine Primer
  try {
    const api1 = `https://ahm7xmakki.com/api/alldl?url=` + encodeURIComponent(cleanUrl);
    const res1 = await fetch(api1, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }
    });
    if (res1.ok) {
      const json1 = await res1.json();
      const parsed = parseIgMedia(json1);

      // Jika berhasil dapat multi-foto (>1) atau video reels murni
      if (parsed.images.length > 1 || isReels || (parsed.videos.length > 0 && parsed.images.length === 0)) {
        const isVid = isReels || (parsed.videos.length > 0 && parsed.images.length === 0);
        return {
          type: isVid ? "video" : "photo",
          title: parsed.title,
          images: isVid ? [] : parsed.images,
          videoUrl: isVid ? (parsed.videos[0] || "") : ""
        };
      }
    }
  } catch {}

  // 2. Coba Engine Sekunder (Khusus Ekstraksi Slide/Carousel)
  try {
    const api2 = `https://api.siputzx.my.id/api/d/ig?url=` + encodeURIComponent(cleanUrl);
    const res2 = await fetch(api2, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }
    });
    if (res2.ok) {
      const json2 = await res2.json();
      const parsed2 = parseIgMedia(json2);

      if (parsed2.images.length > 0 || parsed2.videos.length > 0) {
        const isVid = isReels || (parsed2.videos.length > 0 && parsed2.images.length === 0);
        return {
          type: isVid ? "video" : "photo",
          title: parsed2.title,
          images: isVid ? [] : parsed2.images,
          videoUrl: isVid ? (parsed2.videos[0] || "") : ""
        };
      }
    }
  } catch {}

  // 3. Coba Engine Tersier
  try {
    const api3 = `https://api.vkrdownloader.com/server?vkr=` + encodeURIComponent(cleanUrl);
    const res3 = await fetch(api3, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }
    });
    if (res3.ok) {
      const json3 = await res3.json();
      const parsed3 = parseIgMedia(json3);

      if (parsed3.images.length > 0 || parsed3.videos.length > 0) {
        const isVid = isReels || (parsed3.videos.length > 0 && parsed3.images.length === 0);
        return {
          type: isVid ? "video" : "photo",
          title: parsed3.title,
          images: isVid ? [] : parsed3.images,
          videoUrl: isVid ? (parsed3.videos[0] || "") : ""
        };
      }
    }
  } catch {}

  throw new Error("Gagal mengambil media Instagram. Pastikan akun tidak di-private.");
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

    if (media.type === "photo" && media.images.length > 0) {
      await sendPhotos(chatId, media.images, media.title);

      if (media.audioUrl) {
        await sendAudio(chatId, media.audioUrl, media.title).catch(() => {});
      }
    } else if (media.type === "video" && media.videoUrl) {
      await sendVideo(chatId, media.videoUrl, media.title);
    } else {
      throw new Error("Media tidak ditemukan.");
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
