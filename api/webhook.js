const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID;

const FIREBASE_API_KEY =
  process.env.FIREBASE_API_KEY;

const TELEGRAM_API =
  `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;


/* ==============================
   TELEGRAM API
============================== */

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


/* ==============================
   FIREBASE
============================== */

async function saveUser(user) {

  if (
    !FIREBASE_PROJECT_ID ||
    !FIREBASE_API_KEY
  ) {
    console.log(
      "Firebase belum dikonfigurasi."
    );

    return;
  }

  if (!user?.id) return;

  const userId =
    String(user.id);

  const data = {
    fields: {

      telegram_id: {
        stringValue: userId
      },

      username: {
        stringValue:
          user.username || ""
      },

      first_name: {
        stringValue:
          user.first_name || ""
      },

      last_name: {
        stringValue:
          user.last_name || ""
      },

      last_seen: {
        timestampValue:
          new Date().toISOString()
      }
    }
  };

  const url =
    `https://firestore.googleapis.com/v1/projects/` +
    `${FIREBASE_PROJECT_ID}` +
    `/databases/(default)/documents/users/` +
    `${encodeURIComponent(userId)}` +
    `?key=${FIREBASE_API_KEY}`;

  try {

    const response = await fetch(
      url,
      {
        method: "PATCH",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(data)
      }
    );

    console.log(
      "Firebase status:",
      response.status
    );

  } catch (error) {

    console.error(
      "Firebase error:",
      error.message
    );
  }
}


/* ==============================
   DETECT PLATFORM
============================== */

function detectPlatform(url) {

  try {

    const parsed =
      new URL(url);

    const host =
      parsed.hostname
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


/* ==============================
   VALIDATE URL
============================== */

function isValidUrl(text) {

  try {

    const url =
      new URL(text);

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );

  } catch {

    return false;

  }
}


/* ==============================
   AHM7 DOWNLOAD API
============================== */

async function downloadVideo(url) {

  const apiUrl =
    `https://ahm7xmakki.com/api/alldl?url=` +
    encodeURIComponent(url);

  console.log(
    "Calling downloader API..."
  );

  const response =
    await fetch(apiUrl, {
      method: "GET"
    });

  const text =
    await response.text();

  let data;

  try {

    data =
      JSON.parse(text);

  } catch {

    console.error(
      "API response bukan JSON:",
      text
    );

    throw new Error(
      "Downloader API mengembalikan response tidak valid."
    );

  }

  console.log(
    "Downloader response:",
    JSON.stringify(data)
  );

  if (!response.ok) {

    throw new Error(
      data?.message ||
      `Downloader API error ${response.status}`
    );

  }

  if (
    data?.success !== true
  ) {

    throw new Error(
      data?.message ||
      "Video tidak berhasil diproses."
    );

  }

  const media =
    data?.mediaInfo;

  if (!media) {

    throw new Error(
      "Data media tidak ditemukan."
    );

  }

  if (
    !media.videoUrl
  ) {

    throw new Error(
      "URL video tidak ditemukan."
    );

  }

  return media;

}


/* ==============================
   MAIN WEBHOOK
============================== */

export default async function handler(
  req,
  res
) {

  /* GET */

  if (req.method !== "POST") {

    return res.status(200).json({

      ok: true,

      message:
        "🤖 Bottele Downloader aktif",

      downloader:
        "AHM7xMakki",

      platforms:
        [
          "TikTok",
          "Instagram"
        ]

    });

  }


  try {

    /* ==========================
       CHECK TOKEN
    ========================== */

    if (!TELEGRAM_TOKEN) {

      return res.status(500).json({

        ok: false,

        error:
          "TELEGRAM_TOKEN belum dipasang di Vercel."

      });

    }


    /* ==========================
       TELEGRAM UPDATE
    ========================== */

    const update =
      req.body;

    console.log(
      "Telegram update:",
      JSON.stringify(update)
    );


    const message =
      update?.message;


    if (
      !message?.chat?.id
    ) {

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


    /* ==========================
       SAVE USER
    ========================== */

    if (user) {

      await saveUser(user);

    }


    /* ==========================
       START
    ========================== */

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

Contoh:

🎵 TikTok
https://www.tiktok.com/...

📸 Instagram
https://www.instagram.com/...

⏳ Bot akan memproses otomatis.`

        }
      );

      return res.status(200).json({
        ok: true
      });

    }


    /* ==========================
       HELP
    ========================== */

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

Cara menggunakan:

1️⃣ Salin link video publik
2️⃣ Kirim ke bot
3️⃣ Tunggu proses
4️⃣ Video dikirim otomatis

/private account atau konten
yang membutuhkan login tidak didukung.`

        }
      );

      return res.status(200).json({
        ok: true
      });

    }


    /* ==========================
       EMPTY MESSAGE
    ========================== */

    if (!text) {

      return res.status(200).json({
        ok: true
      });

    }


    /* ==========================
       URL VALIDATION
    ========================== */

    if (
      !isValidUrl(text)
    ) {

      await telegram(
        "sendMessage",
        {

          chat_id: chatId,

          text:
`❌ Link tidak valid.

Kirim link TikTok atau Instagram.`

        }
      );

      return res.status(200).json({
        ok: true
      });

    }


    /* ==========================
       PLATFORM
    ========================== */

    const platform =
      detectPlatform(text);


    if (!platform) {

      await telegram(
        "sendMessage",
        {

          chat_id: chatId,

          text:
`❌ Platform tidak didukung.

Saat ini Bottele mendukung:

🎵 TikTok
📸 Instagram`

        }
      );

      return res.status(200).json({
        ok: true
      });

    }


    /* ==========================
       PROCESSING MESSAGE
    ========================== */

    const processing =
      await telegram(
        "sendMessage",
        {

          chat_id: chatId,

          text:
`⏳ ${platform} diterima.

🔎 Mengambil video...
⚡ Mohon tunggu...`

        }
      );


    /* ==========================
       DOWNLOAD
    ========================== */

    try {

      const media =
        await downloadVideo(text);


      console.log(
        "Title:",
        media.title
      );

      console.log(
        "Platform:",
        media.platform
      );

      console.log(
        "Video URL berhasil didapat."
      );


      /* ========================
         DELETE PROCESS MESSAGE
      ======================== */

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


      /* ========================
         SEND VIDEO
      ======================== */

      const result =
        await telegram(
          "sendVideo",
          {

            chat_id:
              chatId,

            video:
              media.videoUrl,

            caption:
`✅ DOWNLOAD BERHASIL

🎬 ${
  media.title ||
  "Video"
}

📱 ${
  media.platform ||
  platform
}

🤖 Bottele Downloader`

            ,
            
            supports_streaming:
              true

          }
        );


      /* ========================
         CHECK TELEGRAM
      ======================== */

      if (
        !result?.ok
      ) {

        console.error(
          "sendVideo gagal:",
          result
        );


        /* FALLBACK URL */

        await telegram(
          "sendMessage",
          {

            chat_id:
              chatId,

            text:
`⚠️ Video berhasil ditemukan, tetapi Telegram tidak dapat mengirim file tersebut secara langsung.

🔗 Link video:
${media.videoUrl}`

          }
        );

      }


    } catch (error) {

      console.error(
        "DOWNLOAD ERROR:",
        error
      );


      await telegram(
        "sendMessage",
        {

          chat_id:
            chatId,

          text:
`❌ GAGAL DOWNLOAD

Platform:
${platform}

Alasan:
${error.message}

💡 Pastikan link berasal dari konten publik dan masih bisa diakses.`

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

      error:
        error.message

    });

  }

}
