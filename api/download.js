export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
    let body = req.body;

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }

    const url = String(body?.url || "").trim();

    if (!url) {
      return res.status(400).json({
        success: false,
        message: "URL belum diberikan."
      });
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({
        success: false,
        message: "URL tidak valid."
      });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return res.status(400).json({
        success: false,
        message: "Protocol URL tidak valid."
      });
    }

    const apiUrl =
      "https://ahm7xmakki.com/api/alldl?url=" +
      encodeURIComponent(url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55000);

    let response;

    try {
      response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 Cloupanz Downloader"
        },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({
        success: false,
        message: "Downloader API mengirim response yang tidak valid."
      });
    }

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        message:
          data?.message ||
          data?.error ||
          `Downloader API error ${response.status}`
      });
    }

    const media =
      data?.mediaInfo ||
      data?.data?.mediaInfo ||
      data?.result?.mediaInfo ||
      data?.result ||
      data?.data ||
      data;

    const videoUrl =
      media?.videoUrl ||
      media?.video_url ||
      media?.downloadUrl ||
      media?.download_url ||
      media?.video ||
      "";

    const audioUrl =
      media?.audioUrl ||
      media?.audio_url ||
      media?.audio ||
      "";

    const title =
      media?.title ||
      data?.title ||
      "Cloupanz Download";

    const thumbnail =
      media?.thumbnail ||
      media?.thumbnailUrl ||
      media?.thumbnail_url ||
      data?.thumbnail ||
      "";

    if (!videoUrl && !audioUrl) {
      return res.status(502).json({
        success: false,
        message: "Video atau audio tidak ditemukan."
      });
    }

    return res.status(200).json({
      success: true,
      video_url: videoUrl,
      audio_url: audioUrl,
      title,
      thumbnail
    });

  } catch (error) {
    if (error?.name === "AbortError") {
      return res.status(504).json({
        success: false,
        message: "Downloader terlalu lama merespons."
      });
    }

    return res.status(500).json({
      success: false,
      message: error?.message || "Terjadi kesalahan pada server."
    });
  }
}
