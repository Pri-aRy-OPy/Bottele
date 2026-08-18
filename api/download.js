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

    const videos = [];
    const images = [];
    const audios = [];

    const addUnique = (arr, value) => {
      if (!value || typeof value !== "string") return;

      try {
        const u = new URL(value);

        if (
          u.protocol !== "http:" &&
          u.protocol !== "https:"
        ) {
          return;
        }

        if (!arr.includes(value)) {
          arr.push(value);
        }
      } catch {}
    };

    const detectType = (value, fallback = "") => {
      const type = String(
        fallback || ""
      ).toLowerCase();

      if (
        type.includes("video") ||
        type.includes("mp4")
      ) {
        return "video";
      }

      if (
        type.includes("image") ||
        type.includes("photo") ||
        type.includes("jpg") ||
        type.includes("jpeg") ||
        type.includes("png") ||
        type.includes("webp")
      ) {
        return "image";
      }

      if (
        type.includes("audio") ||
        type.includes("mp3") ||
        type.includes("m4a") ||
        type.includes("aac")
      ) {
        return "audio";
      }

      const clean = String(value || "")
        .toLowerCase()
        .split("?")[0];

      if (
        /\.(mp4|webm|mov|m4v|mkv)$/i.test(clean)
      ) {
        return "video";
      }

      if (
        /\.(jpg|jpeg|png|gif|webp|avif)$/i.test(clean)
      ) {
        return "image";
      }

      if (
        /\.(mp3|m4a|aac|ogg|wav|flac)$/i.test(clean)
      ) {
        return "audio";
      }

      return "";
    };

    const addMedia = (item, forcedType = "") => {
      if (!item) return;

      if (typeof item === "string") {
        const type = detectType(item, forcedType);

        if (type === "video") {
          addUnique(videos, item);
        } else if (type === "image") {
          addUnique(images, item);
        } else if (type === "audio") {
          addUnique(audios, item);
        }

        return;
      }

      if (typeof item !== "object") return;

      const type = detectType(
        item.url ||
        item.src ||
        item.mediaUrl ||
        item.downloadUrl ||
        item.download_url ||
        item.videoUrl ||
        item.imageUrl ||
        item.audioUrl,
        item.type ||
        item.mime ||
        forcedType
      );

      const video =
        item.videoUrl ||
        item.video_url ||
        item.video ||
        (
          type === "video"
            ? item.url ||
              item.src ||
              item.mediaUrl ||
              item.downloadUrl ||
              item.download_url
            : ""
        );

      const image =
        item.imageUrl ||
        item.image_url ||
        item.image ||
        (
          type === "image"
            ? item.url ||
              item.src ||
              item.mediaUrl ||
              item.downloadUrl ||
              item.download_url
            : ""
        );

      const audio =
        item.audioUrl ||
        item.audio_url ||
        item.audio ||
        (
          type === "audio"
            ? item.url ||
              item.src ||
              item.mediaUrl ||
              item.downloadUrl ||
              item.download_url
            : ""
        );

      addUnique(videos, video);
      addUnique(images, image);
      addUnique(audios, audio);

      for (const key of [
        "media",
        "items",
        "results",
        "data",
        "carousel",
        "carouselMedia",
        "carousel_media",
        "slides",
        "photos",
        "images",
        "videos",
        "audios"
      ]) {
        if (Array.isArray(item[key])) {
          for (const child of item[key]) {
            addMedia(
              child,
              key.includes("video")
                ? "video"
                : key.includes("audio")
                ? "audio"
                : key.includes("image") ||
                  key.includes("photo")
                ? "image"
                : ""
            );
          }
        }
      }
    };

    addMedia(root);
    addMedia(data);

    addMedia(root?.videoUrl, "video");
    addMedia(root?.video_url, "video");
    addMedia(root?.downloadUrl, "video");
    addMedia(root?.download_url, "video");

    addMedia(root?.audioUrl, "audio");
    addMedia(root?.audio_url, "audio");

    addMedia(root?.imageUrl, "image");
    addMedia(root?.image_url, "image");
    addMedia(root?.image, "image");

    const recursiveScan = (value, depth = 0) => {
      if (!value || depth > 6) return;

      if (Array.isArray(value)) {
        for (const item of value) {
          recursiveScan(item, depth + 1);
        }
        return;
      }

      if (typeof value !== "object") return;

      for (const [key, item] of Object.entries(value)) {
        const lower = key.toLowerCase();

        if (typeof item === "string") {
          if (
            lower.includes("video")
          ) {
            addMedia(item, "video");
          } else if (
            lower.includes("audio") ||
            lower.includes("music")
          ) {
            addMedia(item, "audio");
          } else if (
            lower.includes("image") ||
            lower.includes("photo") ||
            lower === "thumbnail"
          ) {
            addMedia(item, "image");
          } else if (
            lower === "url" ||
            lower === "src" ||
            lower.includes("download")
          ) {
            addMedia(item);
          }
        }

        if (
          Array.isArray(item) ||
          typeof item === "object"
        ) {
          recursiveScan(item, depth + 1);
        }
      }
    };

    recursiveScan(root);
    recursiveScan(data);

    const media = [
      ...videos.map(url => ({
        type: "video",
        url
      })),
      ...images.map(url => ({
        type: "image",
        url
      })),
      ...audios.map(url => ({
        type: "audio",
        url
      }))
    ];

    if (!media.length) {
      return res.status(502).json({
        success: false,
        message: "Media tidak ditemukan dari API downloader."
      });
    }

    let type = "unknown";

    if (
      videos.length &&
      images.length
    ) {
      type = "mixed";
    } else if (videos.length) {
      type = "video";
    } else if (images.length > 1) {
      type = "carousel";
    } else if (images.length === 1) {
      type = "image";
    } else if (audios.length) {
      type = "audio";
    }

    return res.status(200).json({
      success: true,
      type,
      title,
      thumbnail,
      video_url: videos[0] || "",
      video_urls: videos,
      audio_url: audios[0] || "",
      audio_urls: audios,
      images,
      media,
      count: media.length,
      counts: {
        video: videos.length,
        image: images.length,
        audio: audios.length
      }
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
