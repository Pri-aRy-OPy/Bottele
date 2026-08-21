export const config = {
  maxDuration: 30
};

// ==========================================
// 1. ENGINE TIKTOK (TikWM)
// ==========================================
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
    type: isSlide ? (d.images.length > 1 ? "carousel" : "image") : "video",
    title: d.title || "TikTok Media",
    thumbnail: d.cover || d.origin_cover || "",
    videoUrl: isSlide ? "" : (d.play || d.wmplay || ""),
    audioUrl: d.music || "",
    images: isSlide ? d.images : []
  };
}

// ==========================================
// 2. ENGINE INSTAGRAM (Multi-Engine Fallback)
// ==========================================
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
    title: root?.title || json?.title || "Instagram Media",
    thumbnail: root?.thumbnail || root?.display_url || root?.image || ""
  };
}

async function downloadInstagram(rawUrl) {
  const cleanUrl = rawUrl.split("?")[0];
  const isReels = cleanUrl.includes("/reel/") || cleanUrl.includes("/reels/");

  // Engine 1: AllDL
  try {
    const api1 = `https://ahm7xmakki.com/api/alldl?url=` + encodeURIComponent(cleanUrl);
    const res1 = await fetch(api1, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }
    });
    if (res1.ok) {
      const json1 = await res1.json();
      const parsed = parseIgMedia(json1);

      if (parsed.images.length > 1 || isReels || (parsed.videos.length > 0 && parsed.images.length === 0)) {
        const isVid = isReels || (parsed.videos.length > 0 && parsed.images.length === 0);
        return {
          type: isVid ? "video" : (parsed.images.length > 1 ? "carousel" : "image"),
          title: parsed.title,
          thumbnail: parsed.thumbnail,
          images: isVid ? [] : parsed.images,
          videoUrl: isVid ? (parsed.videos[0] || "") : "",
          audioUrl: ""
        };
      }
    }
  } catch {}

  // Engine 2: Siputzx
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
          type: isVid ? "video" : (parsed2.images.length > 1 ? "carousel" : "image"),
          title: parsed2.title,
          thumbnail: parsed2.thumbnail,
          images: isVid ? [] : parsed2.images,
          videoUrl: isVid ? (parsed2.videos[0] || "") : "",
          audioUrl: ""
        };
      }
    }
  } catch {}

  // Engine 3: VKR
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
          type: isVid ? "video" : (parsed3.images.length > 1 ? "carousel" : "image"),
          title: parsed3.title,
          thumbnail: parsed3.thumbnail,
          images: isVid ? [] : parsed3.images,
          videoUrl: isVid ? (parsed3.videos[0] || "") : "",
          audioUrl: ""
        };
      }
    }
  } catch {}

  throw new Error("Gagal mengambil media Instagram. Pastikan akun tidak di-private.");
}

// ==========================================
// 3. MAIN API HANDLER
// ==========================================
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed"
    });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { url } = body;

    if (!url) {
      return res.status(400).json({
        success: false,
        message: "URL wajib diisi"
      });
    }

    const isTikTok = url.includes("tiktok.com");
    const isInstagram = url.includes("instagram.com") || url.includes("instagr.am");

    if (!isTikTok && !isInstagram) {
      return res.status(400).json({
        success: false,
        message: "Hanya platform TikTok dan Instagram yang didukung"
      });
    }

    const media = isTikTok ? await downloadTikTok(url) : await downloadInstagram(url);

    return res.status(200).json({
      success: true,
      type: media.type,
      title: media.title,
      thumbnail: media.thumbnail,
      video_url: media.videoUrl,
      audio_url: media.audioUrl,
      images: media.images,
      count: media.type === "video" ? 1 : (media.type === "audio" ? 1 : media.images.length)
    });
  } catch (error) {
    console.error("DOWNLOAD HANDLER ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Gagal memproses unduhan media"
    });
  }
}
  
