
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed"
    });
  }

  try {
    const { url } = req.body || {};

    if (!url) {
      return res.status(400).json({
        success: false,
        message: "URL wajib diisi"
      });
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({
        success: false,
        message: "URL tidak valid"
      });
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    const supported =
      hostname.includes("tiktok.com") ||
      hostname.includes("instagram.com") ||
      hostname.includes("instagr.am");

    if (!supported) {
      return res.status(400).json({
        success: false,
        message: "Hanya TikTok dan Instagram yang didukung"
      });
    }

    const apiUrl =
      "https://ahm7xmakki.com/api/alldl?url=" +
      encodeURIComponent(url);

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0"
      }
    });

    const raw = await response.text();

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        message: `Downloader API error ${response.status}`,
        detail: raw.slice(0, 500)
      });
    }

    let apiData;

    try {
      apiData = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        success: false,
        message: "Response downloader API bukan JSON"
      });
    }

    const root =
      apiData?.data?.mediaInfo ||
      apiData?.mediaInfo ||
      apiData?.data ||
      apiData?.result ||
      apiData;

    const title =
      root?.title ||
      apiData?.title ||
      "Cloupanz Download";

    const thumbnail =
      root?.thumbnail ||
      root?.thumbnailUrl ||
      root?.thumbnail_url ||
      apiData?.thumbnail ||
      apiData?.thumbnailUrl ||
      "";

    const isValidUrl = value => {
      if (!value || typeof value !== "string") {
        return false;
      }

      try {
        const parsed = new URL(value);

        return (
          parsed.protocol === "http:" ||
          parsed.protocol === "https:"
        );
      } catch {
        return false;
      }
    };

    const firstValid = (...values) => {
      for (const value of values) {
        if (isValidUrl(value)) {
          return value;
        }
      }

      return "";
    };

    let videoUrl = firstValid(
      root?.videoUrl,
      root?.video_url,
      root?.video,
      root?.downloadVideo,
      root?.download_video,
      apiData?.videoUrl,
      apiData?.video_url
    );

    let audioUrl = firstValid(
      root?.audioUrl,
      root?.audio_url,
      root?.audio,
      root?.musicUrl,
      root?.music_url,
      root?.music,
      apiData?.audioUrl,
      apiData?.audio_url
    );

    const images = [];

    const addImage = value => {
      if (!isValidUrl(value)) {
        return;
      }

      if (value === thumbnail) {
        return;
      }

      if (!images.includes(value)) {
        images.push(value);
      }
    };

    const addImageItem = item => {
      if (!item) {
        return;
      }

      if (typeof item === "string") {
        addImage(item);
        return;
      }

      if (typeof item !== "object") {
        return;
      }

      addImage(
        item.url ||
        item.imageUrl ||
        item.image_url ||
        item.downloadUrl ||
        item.download_url ||
        item.src ||
        item.source ||
        item.photo
      );
    };

    const imageArrays = [
      root?.images,
      root?.imageUrls,
      root?.image_urls,
      root?.photos,
      root?.photoUrls,
      root?.photo_urls,
      root?.carousel,
      root?.carouselMedia,
      root?.carousel_media,
      root?.slides,
      root?.items,
      apiData?.images,
      apiData?.imageUrls,
      apiData?.photos,
      apiData?.carousel,
      apiData?.items
    ];

    for (const list of imageArrays) {
      if (!Array.isArray(list)) {
        continue;
      }

      for (const item of list) {
        addImageItem(item);
      }
    }

    addImage(
      root?.image ||
      root?.imageUrl ||
      root?.image_url ||
      root?.photo
    );

    addImage(
      apiData?.image ||
      apiData?.imageUrl ||
      apiData?.image_url ||
      apiData?.photo
    );

    const explicitType = String(
      root?.type ||
      root?.mediaType ||
      root?.media_type ||
      apiData?.type ||
      apiData?.mediaType ||
      apiData?.media_type ||
      ""
    ).toLowerCase();

    const explicitVideo =
      explicitType.includes("video");

    const explicitImage =
      explicitType.includes("image") ||
      explicitType.includes("photo") ||
      explicitType.includes("carousel");

    let type = "unknown";

    if (explicitVideo && videoUrl) {
      type = "video";
    } else if (explicitImage && images.length) {
      type =
        images.length > 1
          ? "carousel"
          : "image";
    } else if (videoUrl) {
      type = "video";
    } else if (images.length) {
      type =
        images.length > 1
          ? "carousel"
          : "image";
    } else if (audioUrl) {
      type = "audio";
    }

    if (type === "video") {
      return res.status(200).json({
        success: true,
        type: "video",
        title,
        thumbnail,
        video_url: videoUrl,
        audio_url: "",
        images: [],
        count: 1
      });
    }

    if (type === "image" || type === "carousel") {
      return res.status(200).json({
        success: true,
        type,
        title,
        thumbnail,
        video_url: "",
        audio_url: audioUrl,
        images,
        count: images.length
      });
    }

    if (type === "audio") {
      return res.status(200).json({
        success: true,
        type: "audio",
        title,
        thumbnail,
        video_url: "",
        audio_url: audioUrl,
        images: [],
        count: 1
      });
    }

    return res.status(404).json({
      success: false,
      message: "Media tidak ditemukan",
      debug: {
        hasVideo: Boolean(videoUrl),
        hasAudio: Boolean(audioUrl),
        imageCount: images.length,
        detectedType: explicitType || null
      }
    });
  } catch (error) {
    console.error("DOWNLOAD ERROR:", error);

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Gagal mengambil media"
    });
  }
      }
