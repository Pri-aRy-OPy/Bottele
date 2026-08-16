const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID;

const FIREBASE_API_KEY =
  process.env.FIREBASE_API_KEY;

const ADMIN_PIN =
  process.env.ADMIN_PIN;

const DAILY_LIMIT =
  Number(process.env.DAILY_LIMIT || 5);

const TELEGRAM_API =
  `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;


/* ==================================================
   BASIC
================================================== */

function today() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}


function userDoc(userId) {
  return String(userId);
}


function firestoreBase() {
  return (
    `https://firestore.googleapis.com/v1/projects/` +
    `${FIREBASE_PROJECT_ID}` +
    `/databases/(default)/documents`
  );
}


/* ==================================================
   TELEGRAM
================================================== */

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


/* ==================================================
   FIREBASE GET USER
================================================== */

async function getUser(userId) {

  if (
    !FIREBASE_PROJECT_ID ||
    !FIREBASE_API_KEY
  ) {
    return null;
  }

  const url =
    `${firestoreBase()}/users/${encodeURIComponent(userDoc(userId))}` +
    `?key=${FIREBASE_API_KEY}`;

  const response =
    await fetch(url);

  if (!response.ok) {
    return null;
  }

  return await response.json();
}


/* ==================================================
   FIREBASE SAVE USER
================================================== */

async function saveUser(user) {

  if (
    !FIREBASE_PROJECT_ID ||
    !FIREBASE_API_KEY ||
    !user?.id
  ) {
    return;
  }

  const id =
    userDoc(user.id);

  const old =
    await getUser(id);

  const currentDate =
    today();

  let downloads =
    Number(
      old?.fields?.downloads?.integerValue || 0
    );

  let lastReset =
    old?.fields?.last_reset?.stringValue || "";

  if (lastReset !== currentDate) {
    downloads = 0;
    lastReset = currentDate;
  }

  const data = {

    fields: {

      telegram_id: {
        stringValue: String(user.id)
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

      downloads: {
        integerValue:
          String(downloads)
      },

      last_reset: {
        stringValue:
          currentDate
      },

      is_admin: {
        booleanValue:
          old?.fields?.is_admin?.booleanValue === true
      },

      last_seen: {
        timestampValue:
          new Date().toISOString()
      }
    }
  };

  const url =
    `${firestoreBase()}/users/${encodeURIComponent(id)}` +
    `?key=${FIREBASE_API_KEY}`;

  await fetch(
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
}


/* ==================================================
   CHECK ADMIN
================================================== */

async function isAdmin(userId) {

  const user =
    await getUser(userId);

  return (
    user?.fields?.is_admin?.booleanValue === true
  );
}


/* ==================================================
   CLAIM ADMIN
================================================== */

async function claimAdmin(user) {

  if (!ADMIN_PIN) {

    return {
      ok: false,
      message:
        "PIN admin belum dikonfigurasi."
    };
  }

  if (
    !FIREBASE_PROJECT_ID ||
    !FIREBASE_API_KEY
  ) {

    return {
      ok: false,
      message:
        "Firebase belum dikonfigurasi."
    };
  }

  /*
   * Cek apakah sudah ada admin.
   */

  const configUrl =
    `${firestoreBase()}/config/bot` +
    `?key=${FIREBASE_API_KEY}`;

  const check =
    await fetch(configUrl);

  if (check.ok) {

    const config =
      await check.json();

    const existingAdmin =
      config?.fields?.admin_id?.stringValue;

    if (existingAdmin) {

      return {
        ok: false,
        message:
          "Admin sudah terdaftar."
      };
    }
  }

  /*
   * PIN benar?
   */

  const args =
    user.__adminPin;

  if (args !== ADMIN_PIN) {

    return {
      ok: false,
      message:
        "PIN salah."
    };
  }

  /*
   * Simpan admin pertama.
   */

  const configData = {

    fields: {

      admin_id: {
        stringValue:
          String(user.id)
      },

      admin_username: {
        stringValue:
          user.username || ""
      },

      created_at: {
        timestampValue:
          new Date().toISOString()
      }
    }
  };

  const saveConfig =
    await fetch(
      configUrl,
      {
        method: "PATCH",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(configData)
      }
    );

  if (!saveConfig.ok) {

    return {
      ok: false,
      message:
        "Gagal menyimpan admin."
    };
  }

  /*
   * Update user jadi admin.
   */

  const userId =
    String(user.id);

  const userUrl =
    `${firestoreBase()}/users/${encodeURIComponent(userId)}` +
    `?key=${FIREBASE_API_KEY}`;

  const old =
    await getUser(userId);

  const data = {

    fields: {

      telegram_id: {
        stringValue:
          userId
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

      downloads: {
        integerValue:
          String(
            old?.fields?.downloads?.integerValue || 0
          )
      },

      last_reset: {
        stringValue:
          today()
      },

      is_admin: {
        booleanValue:
          true
      },

      last_seen: {
        timestampValue:
          new Date().toISOString()
      }
    }
  };

  await fetch(
    userUrl,
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

  return {
    ok: true
  };
}


/* ==================================================
   DOWNLOAD COUNT
================================================== */

async function getDownloadStatus(userId) {

  const user =
    await getUser(userId);

  if (!user) {

    return {
      downloads: 0,
      remaining: DAILY_LIMIT,
      admin: false
    };
  }

  const admin =
    user?.fields?.is_admin?.booleanValue === true;

  if (admin) {

    return {
      downloads: 0,
      remaining: Infinity,
      admin: true
    };
  }

  const lastReset =
    user?.fields?.last_reset?.stringValue || "";

  let downloads =
    Number(
      user?.fields?.downloads?.integerValue || 0
    );

  if (lastReset !== today()) {
    downloads = 0;
  }

  return {

    downloads,

    remaining:
      Math.max(
        DAILY_LIMIT - downloads,
        0
      ),

    admin: false
  };
}


/* ==================================================
   ADD DOWNLOAD
================================================== */

async function addDownload(user) {

  const old =
    await getUser(user.id);

  const currentDate =
    today();

  let downloads =
    Number(
      old?.fields?.downloads?.integerValue || 0
    );

  const lastReset =
    old?.fields?.last_reset?.stringValue || "";

  if (lastReset !== currentDate) {
    downloads = 0;
  }

  downloads++;

  const url =
    `${firestoreBase()}/users/${encodeURIComponent(String(user.id))}` +
    `?key=${FIREBASE_API_KEY}`;

  const data = {

    fields: {

      telegram_id: {
        stringValue:
          String(user.id)
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

      downloads: {
        integerValue:
          String(downloads)
      },

      last_reset: {
        stringValue:
          currentDate
      },

      is_admin: {
        booleanValue:
          old?.fields?.is_admin?.booleanValue === true
      },

      last_seen: {
        timestampValue:
          new Date().toISOString()
      }
    }
  };

  await fetch(
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

  return downloads;
}


/* ==================================================
   PLATFORM
================================================== */

function detectPlatform(url) {

  try {

    const host =
      new URL(url)
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


/* ==================================================
   VALID URL
================================================== */

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


/* ==================================================
   DOWNLOADER API
================================================== */

async function downloadInfo(url) {

  const apiUrl =
    `https://ahm7xmakki.com/api/alldl?url=` +
    encodeURIComponent(url);

  const response =
    await fetch(apiUrl);

  const text =
    await response.text();

  let data;

  try {

    data =
      JSON.parse(text);

  } catch {

    throw new Error(
      "Downloader API tidak merespons dengan benar."
    );
  }

  if (!response.ok) {

    throw new Error(
      data?.message ||
      `API error ${response.status}`
    );
  }

  const media =
    data?.mediaInfo ||
    data?.data?.mediaInfo ||
    data?.result?.mediaInfo;

  if (!media) {

    throw new Error(
      "Video tidak ditemukan."
    );
  }

  const videoUrl =
    media.videoUrl ||
    media.video_url ||
    media.downloadUrl ||
    media.download_url;

  if (!videoUrl) {

    throw new Error(
      "URL video tidak tersedia."
    );
  }

  return {

    videoUrl,

    title:
      media.title ||
      "Video"

  };
}


/* ==================================================
   FETCH VIDEO BUFFER
================================================== */

async function fetchVideoBuffer(videoUrl) {

  const response =
    await fetch(
      videoUrl,
      {
        redirect: "follow"
      }
    );

  if (!response.ok) {

    throw new Error(
      `CDN error ${response.status}`
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

  /*
   * Maksimal sekitar 49MB.
   */

  if (
    contentLength &&
    Number(contentLength) >
      49 * 1024 * 1024
  ) {

    throw new Error(
      "Video terlalu besar."
    );
  }

  const arrayBuffer =
    await response.arrayBuffer();

  const buffer =
    Buffer.from(arrayBuffer);

  if (
    buffer.length >
    49 * 1024 * 1024
  ) {

    throw new Error(
      "Video terlalu besar."
    );
  }

  return {

    buffer,

    contentType
  };
}


/* ==================================================
   SEND VIDEO
================================================== */

async function sendVideo(
  chatId,
  buffer,
  contentType,
  title,
  platform
) {

  const form =
    new FormData();

  form.append(
    "chat_id",
    String(chatId)
  );

  form.append(
    "supports_streaming",
    "true"
  );

  form.append(
    "caption",
`🎬 ${title}

Sumber: ${platform}
☁️ Cloupanz`
  );

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
    "cloupanz.mp4"
  );

  const response =
    await fetch(
      `${TELEGRAM_API}/sendVideo`,
      {
        method: "POST",
        body: form
      }
    );

  return await response.json();
}


/* ==================================================
   MAIN WEBHOOK
================================================== */

export default async function handler(
  req,
  res
) {

  if (req.method !== "POST") {

    return res.status(200).json({

      ok: true,

      bot:
        "Cloupanz Downloader",

      status:
        "online",

      platforms:
        [
          "TikTok",
          "Instagram"
        ]
    });
  }


  try {

    if (!TELEGRAM_TOKEN) {

      return res.status(500).json({
        ok: false,
        error:
          "TELEGRAM_TOKEN belum dipasang."
      });
    }


    const update =
      req.body;

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


    /* =========================
       SAVE USER
    ========================= */

    await saveUser(user);


    /* =========================
       START
    ========================= */

    if (
      text === "/start" ||
      text.startsWith("/start ")
    ) {

      await telegram(
        "sendMessage",
        {

          chat_id:
            chatId,

          text:
`Halo ${
  user?.first_name ||
  "kak"
} 👋

Kirim link TikTok atau Instagram.
Nanti videonya langsung dikirim ke sini.

📌 Limit harian: ${DAILY_LIMIT} video

/help untuk bantuan`

        }
      );

      return res.status(200).json({
        ok: true
      });
    }


    /* =========================
       HELP
    ========================= */

    if (text === "/help") {

      await telegram(
        "sendMessage",
        {

          chat_id:
            chatId,

          text:
`📖 Cara pakai

1. Salin link video
2. Kirim ke sini
3. Tunggu sebentar
4. Video langsung masuk

Bisa:
• TikTok
• Instagram

/limit — cek sisa limit`

        }
      );

      return res.status(200).json({
        ok: true
      });
    }


    /* =========================
       LIMIT
    ========================= */

    if (
      text === "/limit" ||
      text === "/me"
    ) {

      const status =
        await getDownloadStatus(
          user.id
        );

      if (status.admin) {

        await telegram(
          "sendMessage",
          {

            chat_id:
              chatId,

            text:
`👑 Admin Cloupanz

Limit download:
∞ Tanpa batas`

          }
        );

      } else {

        await telegram(
          "sendMessage",
          {

            chat_id:
              chatId,

            text:
`📊 Limit kamu

Hari ini:
${status.downloads}/${DAILY_LIMIT}

Sisa:
${status.remaining} download`

          }
        );
      }

      return res.status(200).json({
        ok: true
      });
    }


    /* =========================
       CLAIM ADMIN
    ========================= */

    if (
      text.startsWith("/admin ")
    ) {

      const pin =
        text
          .slice(7)
          .trim();

      const adminUser = {
        ...user,
        __adminPin: pin
      };

      const result =
        await claimAdmin(
          adminUser
        );

      if (result.ok) {

        await telegram(
          "sendMessage",
          {

            chat_id:
              chatId,

            text:
`👑 Admin berhasil diaktifkan.

Selamat datang di
Cloupanz Control Panel.

Kamu sekarang punya akses
tanpa limit.`

          }
        );

      } else {

        await telegram(
          "sendMessage",
          {

            chat_id:
              chatId,

            text:
              `❌ ${result.message}`

          }
        );
      }

      return res.status(200).json({
        ok: true
      });
    }


    /* =========================
       ADMIN CHECK
    ========================= */

    const admin =
      await isAdmin(user.id);


    /* =========================
       ADMIN STATS
    ========================= */

    if (
      text === "/stats"
    ) {

      if (!admin) {

        await telegram(
          "sendMessage",
          {

            chat_id:
              chatId,

            text:
              "❌ Perintah khusus admin."

          }
        );

        return res.status(200).json({
          ok: true
        });
      }

      /*
       * Ambil seluruh user.
       */

      const url =
        `${firestoreBase()}/users` +
        `?key=${FIREBASE_API_KEY}`;

      const response =
        await fetch(url);

      const data =
        await response.json();

      const users =
        data.documents || [];

      let totalDownloads = 0;

      for (
        const item of users
      ) {

        totalDownloads +=
          Number(
            item?.fields?.downloads?.integerValue || 0
          );
      }

      await telegram(
        "sendMessage",
        {

          chat_id:
            chatId,

          text:
`📊 Cloupanz Stats

👥 Users:
${users.length}

🎬 Download hari ini:
${totalDownloads}

👑 Admin:
Aktif`

        }
      );

      return res.status(200).json({
        ok: true
      });
    }


    /* =========================
       URL
    ========================= */

    if (!text) {

      return res.status(200).json({
        ok: true
      });
    }


    if (!isValidUrl(text)) {

      await telegram(
        "sendMessage",
        {

          chat_id:
            chatId,

          text:
            "Kirim link TikTok atau Instagram ya 🙂"

        }
      );

      return res.status(200).json({
        ok: true
      });
    }


    /* =========================
       PLATFORM
    ========================= */

    const platform =
      detectPlatform(text);

    if (!platform) {

      await telegram(
        "sendMessage",
        {

          chat_id:
            chatId,

          text:
`Belum bisa untuk link itu.

Saat ini:
🎵 TikTok
📸 Instagram`

        }
      );

      return res.status(200).json({
        ok: true
      });
    }


    /* =========================
       LIMIT CHECK
    ========================= */

    const status =
      await getDownloadStatus(
        user.id
      );

    if (
      !status.admin &&
      status.remaining <= 0
    ) {

      await telegram(
        "sendMessage",
        {

          chat_id:
            chatId,

          text:
`Limit hari ini sudah habis 😅

Batas:
${DAILY_LIMIT} video/hari

Coba lagi besok.`

        }
      );

      return res.status(200).json({
        ok: true
      });
    }


    /* =========================
       PROCESSING
    ========================= */

    const processing =
      await telegram(
        "sendMessage",
        {

          chat_id:
            chatId,

          text:
`⏳ Tunggu sebentar...

🔎 Mengambil video ${platform}...`

        }
      );


    try {

      /* =======================
         GET VIDEO
      ======================= */

      const info =
        await downloadInfo(
          text
        );


      /* =======================
         FETCH
      ======================= */

      const video =
        await fetchVideoBuffer(
          info.videoUrl
        );


      /* =======================
         TELEGRAM
      ======================= */

      const result =
        await sendVideo(
          chatId,
          video.buffer,
          video.contentType,
          info.title,
          platform
        );
  
