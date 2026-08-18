export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    return res.status(200).json({
      success: true,
      service: "Cloupanz Downloader",
      status: "online"
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method tidak diizinkan."
    });
  }

  try {
    let body = req.body || {};

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }

    const url = String(body.url || "").trim();

    if (!url) {
      return res.status(400).json({
        success: false,
        message: "URL belum diberikan."
      });
    }

    try {
      new URL(url);
    } catch {
      return res.status(400).json({
        success: false,
        message: "URL tidak valid."
      });
    }

    const apiUrl =
      "https://ahm7xmakki.com/api/alldl?url=" +
      encodeURIComponent(url);

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
      return res.status(502).json({
        success: false,
        message: "API downloader mengirim response tidak valid."
      });
    }

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        message:
          data?.message ||
          data?.error ||
          `API downloader error ${response.status}`
      });
    }

    const found = {
      videos: [],
      audios: [],
      images: []
    };

    const visited = new WeakSet();

    function isUrl(value) {
      if (typeof value !== "string") return false;

      try {
        const u = new URL(value);

        return (
          u.protocol === "http:" ||
          u.protocol === "https:"
        );
      } catch {
        return false;
      }
    }

    function addMedia(type, value) {
      if (!isUrl(value)) return;

      const clean = value.trim();

      if (!clean) return;

      if (type === "video") {
        found.videos.push(clean);
      }

      if (type === "audio") {
        found.audios.push(clean);
      }

      if (type === "image") {
        found.images.push(clean);
      }
    }

    function guessType(key, value) {
      const k = String(key || "").toLowerCase();

      if (
        k.includes("video") ||
        k.includes("mp4") ||
        k.includes("video_url")
      ) {
        return "video";
      }

      if (
        k.includes("audio") ||
        k.includes("music") ||
        k.includes("song") ||
        k.includes("mp3")
      ) {
        return "audio";
      }

      if (
        k.includes("image") ||
        k.includes("photo") ||
        k.includes("picture") ||
        k.includes("thumbnail") ||
        k.includes("cover")
      ) {
        return "image";
      }

      if (typeof value === "string") {
        const lower = value.toLowerCase();

        if (
          lower.includes(".mp4") ||
          lower.includes(".webm") ||
          lower.includes(".mov") ||
          lower.includes(".m4v")
        ) {
          return "video";
        }

        if (
          lower.includes(".mp3") ||
          lower.includes(".m4a") ||
          lower.includes(".aac") ||
          lower.includes(".ogg") ||
          lower.includes(".wav")
        ) {
          return "audio";
        }

        if (
          lower.includes(".jpg") ||
          lower.includes(".jpeg") ||
          lower.includes(".png") ||
          lower.includes(".webp") ||
          lower.includes(".gif")
        ) {
          return "image";
        }
      }

      return null;
    }

    function scan(value, key = "") {
      if (value == null) return;

      if (typeof value === "string") {
        const type = guessType(key, value);

        if (type) {
          addMedia(type, value);
        }

        return;
      }

      if (typeof value !== "object") return;

      if (visited.has(value)) return;

      visited.add(value);

      if (Array.isArray(value)) {
        for (const item of value) {
          scan(item, key);
        }

        return;
      }

      for (const [k, v] of Object.entries(value)) {
        const type = guessType(k, v);

        if (typeof v === "string" && type) {
          addMedia(type, v);
        }

        scan(v, k);
      }
    }

    scan(data);

    function unique(list) {
      return [...new Set(list.filter(Boolean))];
    }

    found.videos = unique(found.videos);
    found.audios = unique(found.audios);
    found.images = unique(found.images);

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

    let videoUrl = found.videos[0] || "";
    let audioUrl = found.audios[0] || "";

    let images = found.images;

    if (
      typeof root?.image === "string" &&
      isUrl(root.image)
    ) {
      images.push(root.image);
    }

    if (
      typeof root?.imageUrl === "string" &&
      isUrl(root.imageUrl)
    ) {
      images.push(root.imageUrl);
    }

    if (
      typeof root?.photo === "string" &&
      isUrl(root.photo)
    ) {
      images.push(root.photo);
    }

    if (
      typeof root?.photoUrl === "string" &&
      isUrl(root.photoUrl)
    ) {
      images.push(root.photoUrl);
    }

    images = unique(images);

    const thumbnail =
      root?.thumbnail ||
      root?.thumbnailUrl ||
      root?.thumbnail_url ||
      images[0] ||
      "";

    if (!videoUrl && root?.url && root?.type === "video") {
      videoUrl = root.url;
    }

    if (!audioUrl && root?.url && root?.type === "audio") {
      audioUrl = root.url;
    }

    if (
      !videoUrl &&
      !audioUrl &&
      !images.length
    ) {
      return res.status(502).json({
        success: false,
        message:
          "Media tidak ditemukan dari API downloader."
      });
    }

    let type = "unknown";

    if (videoUrl) {
      type = "video";
    } else if (audioUrl) {
      type = "audio";
    } else if (images.length > 1) {
      type = "carousel";
    } else if (images.length === 1) {
      type = "image";
    }

    return res.status(200).json({
      success: true,
      type,
      title,
      thumbnail,
      video_url: videoUrl,
      audio_url: audioUrl,
      images,
      videos: found.videos,
      audios: found.audios,
      count: images.length
    });

  } catch (error) {
    if (error?.name === "AbortError") {
      return res.status(504).json({
        success: false,
        message: "API downloader terlalu lama merespons."
      });
    }

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Terjadi kesalahan server."
    });
  }
}
