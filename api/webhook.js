const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

const TELEGRAM_API =
  `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

/* =========================
   TELEGRAM API
========================= */

async function telegram(method, data) {
  const response = await fetch(
    `${TELEGRAM_API}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    }
  );

  return await response.json();
}


/* =========================
   DETECT PLATFORM
========================= */

function detectPlatform(url) {
  try {
    const host = new URL(url)
      .hostname
      .toLowerCase()
      .replace(/^www\./, "");

    if (
      host === "tiktok.com" ||
      host.endsWith(".tiktok.com")
    ) {
      return "TikTok";
    }

    if (
      host === "instagram.com" ||
      host.endsWith(".instagram.com")
    ) {
      return "Instagram";
    }

    return null;
  } catch {
    return null;
  }
}


/* =========================
   VALIDATE URL
========================= */

function isValidUrl(text) {
  try {
    const url = new URL(text);

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );
  } catch {
    return false;
  }
}


/* =========================
   DOWNLOADER API
========================= */

async function downloadInfo(url) {

  const apiUrl =
    `https://ahm7xmakki.com/api/alldl?url=` +
    encodeURIComponent(url);

  const response = await fetch(apiUrl);

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    console.error(
      "Downloader response:",
      text
    );

    throw new Error(
      "Downloader API mengembalikan data tidak valid."
    );
  }

  console.log(
    "Downloader:",
    JSON.stringify(data)
  );

  if (!response.ok) {
    throw new Error(
      data?.message ||
      `Downloader HTTP ${response.status}`
    );
  }

  const media =
    data?.mediaInfo ||
    data?.data?.mediaInfo ||
    data?.result?.mediaInfo;

  if (!media) {
    throw new Error(
      data?.message ||
      "Data media tidak ditemukan."
    );
  }

  const videoUrl =
    media.videoUrl ||
    media.video_url ||
    media.downloadUrl ||
    media.download_url;

  if (!videoUrl) {
    throw new Error(
      "URL video tidak ditemukan."
    );
  }

  return {
    videoUrl,
    title:
      media.title ||
      media.caption ||
      "Video"
  };
}


/* =========================
   DOWNLOAD VIDEO KE MEMORY
========================= */

async function fetchVideoBuffer(videoUrl) {

  console.log(
    "Mengambil video dari CDN..."
  );

  const response =
    await fetch(videoUrl, {
      redirect: "follow"
    });

  if (!response.ok) {
    throw new Error(
      `CDN video HTTP ${response.status}`
    );
  }

  const contentType =
    response.headers.get(
      "content-type"
    ) || "video/mp4";

  const contentLength =
    response.headers.get(
      "content-length"
    );

  console.log(
    "Content-Type:",
    contentType
  );

  console.log(
    "Content-Length:",
    contentLength
  );

  /*
   * Batasi sekitar 49 MB agar tidak
   * terlalu membebani memory server.
   */

  if (
    contentLength &&
    Number(contentLength) >
      49 * 1024 * 1024
  ) {
    throw new Error(
      "Ukuran video terlalu besar untuk diproses server."
    );
  }

  const arrayBuffer =
    await response.arrayBuffer();

  const buffer =
    Buffer.from(arrayBuffer);

  console.log(
    "Video berhasil diambil:",
    buffer.length,
    "bytes"
  );

  return {
    buffer,
    contentType
  };
}


/* =========================
   UPLOAD BUFFER KE TELEGRAM
========================= */

async function uploadVideoToTelegram(
  chatId,
  buffer,
  contentType,
  title,
  platform
) {

  /*
   * Node.js / Vercel menyediakan
   * FormData + Blob.
   */

  const form =
    new FormData();

  form.append(
    "chat_id",
    String(chatId)
  );

  form.append(
    "caption",
    `✅ DOWNLOAD BERHASIL\n\n` +
    `🎬 ${title}\n` +
    `📱 ${platform}\n\n` +
    `🤖 Bottele Downloader`
  );

  form.append(
    "supports_streaming",
    "true"
  );

  const extension =
    contentType.includes("webm")
      ? "webm"
      : "mp4";

  const blob =
    new Blob(
      [buffer],
      {
        type: contentType
      }
    );

  form.append(
    "video",
    blob,
    `bottele.${extension}`
  );

  console.log(
    "Upload video ke Telegram..."
  );

  const response =
    await fetch(
      `${TELEGRAM_API}/sendVideo`,
      {
        method: "POST",
        body: form
      }
    );

  const result =
    await response.json();

  console.log(
    "Telegram sendVideo:",
    JSON.stringify(result)
  );

  return result;
}


/* =========================
   MAIN WEBHOOK
========================= */

export default async function handler(
  req,
  res
) {

  /* =======================
     GET TEST
  ======================= */

  if (req.method !== "POST") {

    return res.status(200).json({
      ok: true,
      message:
        "🤖 Bottele Downloader aktif",
      downloader:
        "AHM7xMakki",
      upload:
        "Buffer → Telegram",
      platforms: [
        "TikTok",
        "Instagram"
      ]
    });
  }


  try {

    /* =====================
       TOKEN
    ===================== */

    if (!TELEGRAM_TOKEN) {

      return res.status(500).json({
        ok: false,
        error:
          "TELEGRAM_TOKEN belum dikonfigurasi."
      });
    }


    /* =====================
       UPDATE TELEGRAM
    ===================== */

    const update =
      req.body;

    console.log(
      "Telegram update:",
      JSON.stringify(update)
    );

    const message =
      update?.message;

    if (!message?.chat?.id) {

      return res.status(200).json({
        ok: true
      });
    }


    const chatId =
      message.chat.id;

    const user =
      message.from;

    const text =
      message.text?.trim() || "";


    /* =====================
       START
    ===================== */

    if (
      text === "/start" ||
      text.startsWith("/start ")
    ) {

      await telegram(
        "sendMessage",
        {
          chat_id: chatId,

          text:
`🎬 BOTTELE DOWNLOADER

Halo ${
  user?.first_name ||
  "kak"
} 👋

Kirim link TikTok atau Instagram publik.

🎵 TikTok
📸 Instagram

Bot akan mengambil video
dan mengirimkannya langsung
ke chat.`
        }
      );

      return res.status(200).json({
        ok: true
      });
    }


    /* =====================
       HELP
    ===================== */

    if (text === "/help") {

      await telegram(
        "sendMessage",
        {
          chat_id: chatId,

          text:
`📚 BOTTELE HELP

Platform:
🎵 TikTok
📸 Instagram

Cara:
1. Salin link video
2. Kirim ke bot
3. Tunggu proses
4. Video dikirim langsung

Gunakan link konten publik.`
        }
      );

      return res.status(200).json({
        ok: true
      });
    }


    /* =====================
       EMPTY
    ===================== */

    if (!text) {
      return res.status(200).json({
        ok: true
      });
    }


    /* =====================
       VALIDATE URL
    ===================== */

    if (!isValidUrl(text)) {

      await telegram(
        "sendMessage",
        {
          chat_id: chatId,

          text:
            "❌ Kirim link TikTok atau Instagram yang valid."
        }
      );

      return res.status(200).json({
        ok: true
      });
    }


    /* =====================
       DETECT PLATFORM
    ===================== */

    const platform =
      detectPlatform(text);

    if (!platform) {

      await telegram(
        "sendMessage",
        {
          chat_id: chatId,

          text:
`❌ Platform belum didukung.

🎵 TikTok
📸 Instagram`
        }
      );

      return res.status(200).json({
        ok: true
      });
    }


    /* =====================
       PROCESSING
    ===================== */

    const processing =
      await telegram(
        "sendMessage",
        {
          chat_id: chatId,

          text:
`⏳ ${platform} diterima.

🔎 Mencari video...
⬇️ Menyiapkan file...
📤 Menunggu upload ke Telegram...`
        }
      );


    try {

      /* ===================
         API DOWNLOADER
      =================== */

      const info =
        await downloadInfo(text);


      console.log(
        "Video URL ditemukan."
      );


      /* ===================
         FETCH VIDEO
      =================== */

      const video =
        await fetchVideoBuffer(
          info.videoUrl
        );


      /* ===================
         UPLOAD TELEGRAM
      =================== */

      const result =
        await uploadVideoToTelegram(
          chatId,
          video.buffer,
          video.contentType,
          info.title,
          platform
        );


      /* ===================
         CHECK RESULT
      =================== */

      if (!result?.ok) {

        console.error(
          "Telegram upload gagal:",
          result
        );

        throw new Error(
          result?.description ||
          "Telegram gagal menerima video."
        );
      }


      /* ===================
         DELETE PROCESSING
      =================== */

      if (
        processing?.result?.message_id
      ) {

        await telegram(
          "deleteMessage",
          {
            chat_id:
              chatId,

            message_id:
              processing.result.message_id
          }
        );
      }


      console.log(
        "✅ VIDEO TERKIRIM"
      );


    } catch (error) {

      console.error(
        "DOWNLOAD/UPLOAD ERROR:",
        error
      );


      await telegram(
        "sendMessage",
        {
          chat_id: chatId,

          text:
`❌ GAGAL MENGIRIM VIDEO

Platform:
${platform}

Alasan:
${error.message}

💡 Coba link publik lainnya.`
        }
      );
    }


    return res.status(200).json({
      ok: true
    });


  } catch (error) {

    console.error(
      "WEBHOOK ERROR:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
