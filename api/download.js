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

    let images = [];

    const sources = [
      root?.images,
      root?.imageUrls,
      root?.image_urls,
      root?.photos,
      root?.photoUrls,
      root?.photo_urls,
      root?.media,
      data?.images,
      data?.photos
    ];

    for (const source of sources) {
      if (!Array.isArray(source)) continue;

      for (const item of source) {
        if (typeof item === "string") {
          images.push(item);
        } else if (item && typeof item === "object") {
          const image =
            item.url ||
            item.imageUrl ||
            item.image_url ||
            item.downloadUrl ||
            item.download_url;

          if (image) images.push(image);
        }
      }
    }

    if (typeof root?.image === "string") {
      images.push(root.image);
    }

    if (typeof root?.imageUrl === "string") {
      images.push(root.imageUrl);
    }

    if (typeof data?.image === "string") {
      images.push(data.image);
    }

    images = [...new Set(images.filter(Boolean))];

    if (!videoUrl && root?.url && root?.type === "video") {
      videoUrl = root.url;
    }

    if (!audioUrl && root?.url && root?.type === "audio") {
      audioUrl = root.url;
    }

    if (!videoUrl && !audioUrl && !images.length) {
      return res.status(502).json({
        success: false,
        message: "Media tidak ditemukan dari API downloader."
      });
    }

    let type = "unknown";

    if (images.length && !videoUrl && !audioUrl) {
      type = images.length > 1 ? "carousel" : "image";
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
      images,
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
      message: error?.message || "Terjadi kesalahan server."
    });
  }
}
