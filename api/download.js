export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

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
    const timeout = setTimeout(() => controller.abort(), 55000);

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

    const thumbnail =
      root?.thumbnail ||
      root?.thumbnailUrl ||
      root?.thumbnail_url ||
      data?.thumbnail ||
      "";

    let videoUrl =
      root?.videoUrl ||
      root?.video_url ||
      root?.downloadUrl ||
      root?.download_url ||
      root?.video ||
      "";

    let audioUrl =
      root?.audioUrl ||
      root?.audio_url ||
      root?.audio ||
      "";

    const images = [];

    const addImage = value => {
      if (!value || typeof value !== "string") return;

      try {
        const parsed = new URL(value);

        if (
          parsed.protocol === "http:" ||
          parsed.protocol === "https:"
        ) {
          images.push(value);
        }
      } catch {}
    };

    const addImageObject = item => {
      if (!item) return;

      if (typeof item === "string") {
        addImage(item);
        return;
      }

      if (typeof item !== "object") return;

      addImage(
        item.url ||
        item.imageUrl ||
        item.image_url ||
        item.downloadUrl ||
        item.download_url ||
        item.src ||
        item.source
      );
    };

    const imageSources = [
      root?.images,
      root?.imageUrls,
      root?.image_urls,
      root?.photos,
      root?.photoUrls,
      root?.photo_urls,
      root?.media,
      root?.items,
      root?.slides,
      root?.carousel,
      root?.carouselMedia,
      root?.carousel_media,
      root?.resources,
      data?.images,
      data?.photos,
      data?.media,
      data?.items
    ];

    for (const source of imageSources) {
      if (Array.isArray(source)) {
        for (const item of source) {
          addImageObject(item);
        }
      }
    }

    addImage(root?.image);
    addImage(root?.imageUrl);
    addImage(root?.image_url);
    addImage(root?.photo);
    addImage(root?.photoUrl);
    addImage(root?.photo_url);
    addImage(data?.image);
    addImage(data?.imageUrl);
    addImage(data?.image_url);

    const walk = (value, depth = 0) => {
      if (!value || depth > 5) return;

      if (Array.isArray(value)) {
        for (const item of value) {
          walk(item, depth + 1);
        }
        return;
      }

      if (typeof value !== "object") return;

      for (const [key, item] of Object.entries(value)) {
        const lower = key.toLowerCase();

        if (
          typeof item === "string" &&
          (
            lower.includes("image") ||
            lower.includes("photo") ||
            lower === "src"
          )
        ) {
          addImage(item);
        }

        if (
          Array.isArray(item) &&
          (
            lower.includes("image") ||
            lower.includes("photo") ||
            lower.includes("media") ||
            lower.includes("carousel") ||
            lower.includes("slide")
          )
        ) {
          for (const entry of item) {
            addImageObject(entry);
            walk(entry, depth + 1);
          }
        }

        if (item && typeof item === "object") {
          walk(item, depth + 1);
        }
      }
    };

    walk(root);
    walk(data);

    const uniqueImages = [...new Set(images)];

    if (
      !videoUrl &&
      root?.url &&
      String(root?.type || "").toLowerCase() === "video"
    ) {
      videoUrl = root.url;
    }

    if (
      !audioUrl &&
      root?.url &&
      String(root?.type || "").toLowerCase() === "audio"
    ) {
      audioUrl = root.url;
    }

    if (!videoUrl && !audioUrl && !uniqueImages.length) {
      return res.status(502).json({
        success: false,
        message: "Media tidak ditemukan dari API downloader."
      });
    }

    let type = "unknown";

    if (uniqueImages.length && !videoUrl && !audioUrl) {
      type = uniqueImages.length > 1 ? "carousel" : "image";
    } else if (videoUrl) {
      type = "video";
    } else if (audioUrl) {
      type = "audio";
    }

    return res.status(200).json({
      success: true,
      type,
      title,
      thumbnail,
      video_url: videoUrl,
      audio_url: audioUrl,
      images: uniqueImages,
      count: uniqueImages.length
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
        "Terjadi kesalahan pada server."
    });
  }
}
