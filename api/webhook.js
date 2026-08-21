export const config = {
  maxDuration: 30
};

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const ADMIN_PIN = process.env.ADMIN_PIN;
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 5);

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// ==========================================
// 1. HELPER FIRESTORE & DATABASE
// ==========================================

function today() {
  return new Date().toISOString().slice(0, 10);
}

function firestoreBase() {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

function userDoc(id) {
  return String(id);
}

async function getUser(id) {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY) return null;

  try {
    const url = `${firestoreBase()}/users/${encodeURIComponent(userDoc(id))}?key=${FIREBASE_API_KEY}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function saveUser(user) {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY || !user?.id) return;

  try {
    const id = userDoc(user.id);
    const old = await getUser(id);
    const date = today();

    let downloads = Number(old?.fields?.downloads?.integerValue || 0);
    let lastReset = old?.fields?.last_reset?.stringValue || "";

    if (lastReset !== date) {
      downloads = 0;
      lastReset = date;
    }

    const data = {
      fields: {
        telegram_id: { stringValue: String(user.id) },
        username: { stringValue: user.username || "" },
        first_name: { stringValue: user.first_name || "" },
        last_name: { stringValue: user.last_name || "" },
        downloads: { integerValue: String(downloads) },
        last_reset: { stringValue: lastReset },
        is_admin: { booleanValue: old?.fields?.is_admin?.booleanValue === true },
        last_seen: { timestampValue: new Date().toISOString() }
      }
    };

    const url = `${firestoreBase()}/users/${encodeURIComponent(id)}?key=${FIREBASE_API_KEY}`;
    await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
  } catch (err) {
    console.error("SaveUser Error:", err);
  }
}

async function isAdmin(id) {
  const user = await getUser(id);
  return user?.fields?.is_admin?.booleanValue === true;
}

async function claimAdmin(user) {
  if (!ADMIN_PIN) return { ok: false, message: "PIN admin belum dikonfigurasi di server." };
  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY) return { ok: false, message: "Firebase belum dikonfigurasi." };
  if (user.__adminPin !== ADMIN_PIN) return { ok: false, message: "PIN salah." };

  try {
    const configUrl = `${firestoreBase()}/config/bot?key=${FIREBASE_API_KEY}`;
    const check = await fetch(configUrl);

    if (check.ok) {
      const configData = await check.json();
      const existing = configData?.fields?.admin_id?.stringValue;
      if (existing && existing !== String(user.id)) {
        return { ok: false, message: "Admin sudah terdaftar sebelumnya." };
      }
    }

    await fetch(configUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          admin_id: { stringValue: String(user.id) },
          admin_username: { stringValue: user.username || "" },
          created_at: { timestampValue: new Date().toISOString() }
        }
      })
    });

    const userId = String(user.id);
    const userUrl = `${firestoreBase()}/users/${encodeURIComponent(userId)}?key=${FIREBASE_API_KEY}`;
    const old = await getUser(userId);

    await fetch(userUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          telegram_id: { stringValue: userId },
          username: { stringValue: user.username || "" },
          first_name: { stringValue: user.first_name || "" },
          last_name: { stringValue: user.last_name || "" },
          downloads: { integerValue: String(old?.fields?.downloads?.integerValue || 0) },
          last_reset: { stringValue: today() },
          is_admin: { booleanValue: true },
          last_seen: { timestampValue: new Date().toISOString() }
        }
      })
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message || "Gagal menyimpan data admin." };
  }
}

async function getDownloadStatus(id) {
  const user = await getUser(id);
  if (!user) {
    return { downloads: 0, remaining: DAILY_LIMIT, admin: false };
  }

  const admin = user?.fields?.is_admin?.booleanValue === true;
  if (admin) {
    return { downloads: 0, remaining: Infinity, admin: true };
  }

  let downloads = Number(user?.fields?.downloads?.integerValue || 0);
  const lastReset = user?.fields?.last_reset?.stringValue || "";

  if (lastReset !== today()) {
    downloads = 0;
  }

  return {
    downloads,
    remaining: Math.max(DAILY_LIMIT - downloads, 0),
    admin: false
  };
}

async function addDownload(user) {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY) return;

  try {
    const old = await getUser(user.id);
    const date = today();

    let downloads = Number(old?.fields?.downloads?.integerValue || 0);
    const lastReset = old?.fields?.last_reset?.stringValue || "";

    if (lastReset !== date) {
      downloads = 0;
    }

    downloads++;

    const url = `${firestoreBase()}/users/${encodeURIComponent(String(user.id))}?key=${FIREBASE_API_KEY}`;
    await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          telegram_id: { stringValue: String(user.id) },
          username: { stringValue: user.username || "" },
          first_name: { stringValue: user.first_name || "" },
          last_name: { stringValue: user.last_name || "" },
          downloads: { integerValue: String(downloads) },
          last_reset: { stringValue: date },
          is_admin: { booleanValue: old?.fields?.is_admin?.booleanValue === true },
          last_seen: { timestampValue: new Date().toISOString() }
        }
      })
    });
  } catch (err) {
    console.error("AddDownload Error:", err);
  }
}

// ==========================================
// 2. TELEGRAM SENDER & PROGRESS ANIMATION
// ==========================================

async function sendTextMessage(chatId, text, replyMarkup = null) {
  const body = { chat_id: chatId, text };
  if (replyMarkup) body.reply_markup = replyMarkup;

  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return await res.json().catch(() => ({}));
}

async function updateProgress(chatId, messageId, percent, statusText) {
  const totalBars = 10;
  const filledBars = Math.min(10, Math.max(0, Math.round((percent / 100) * totalBars)));
  const emptyBars = totalBars - filledBars;
  const bar = "█".repeat(filledBars) + "░".repeat(emptyBars);

  await fetch(`${TELEGRAM_API}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: `⏳ ${statusText}\n\n[${bar}] ${percent}%\n\n☁️ Cloupanz`
    })
  }).catch(() => {});
}

async function deleteMessage(chatId, messageId) {
  await fetch(`${TELEGRAM_API}/deleteMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId })
  }).catch(() => {});
}

async function getFileBlob(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
  });
  if (!res.ok) throw new Error(`Gagal unduh sumber file (${res.status})`);
  return await res.blob();
}

async function sendVideo(chatId, videoUrl, title) {
  const blob = await getFileBlob(videoUrl);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("video", blob, "video.mp4");
  form.append("caption", `🎬 ${title}\n\n☁️ Cloupanz`);
  form.append("supports_streaming", "true");

  const res = await fetch(`${TELEGRAM_API}/sendVideo`, { method: "POST", body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(json.description || "Gagal kirim video");
}

async function sendPhotos(chatId, imageUrls, title) {
  const urls = imageUrls.slice(0, 10);

  if (urls.length === 1) {
    const blob = await getFileBlob(urls[0]);
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("photo", blob, "photo.jpg");
    form.append("caption", `🖼️ ${title}\n\n☁️ Cloupanz`);

    const res = await fetch(`${TELEGRAM_API}/sendPhoto`, { method: "POST", body: form });
    const json = await res.json();
    if (!json.ok) throw new Error(json.description || "Gagal kirim foto");
    return;
  }

  const blobs = await Promise.all(urls.map(url => getFileBlob(url)));

  const form = new FormData();
  form.append("chat_id", String(chatId));

  const mediaGroup = blobs.map((blob, index) => {
    const attachName = `photo_${index}`;
    form.append(attachName, blob, `${attachName}.jpg`);
    return {
      type: "photo",
      media: `attach://${attachName}`,
      caption: index === 0 ? `🖼️ ${title} (${urls.length} foto)\n\n☁️ Cloupanz` : undefined
    };
  });

  form.append("media", JSON.stringify(mediaGroup));

  const res = await fetch(`${TELEGRAM_API}/sendMediaGroup`, { method: "POST", body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(json.description || "Gagal kirim album foto");
}

async function sendAudio(chatId, audioUrl, title) {
  const blob = await getFileBlob(audioUrl);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("audio", blob, "audio.mp3");
  form.append("title", "Audio Musik");
  form.append("caption", `🎵 Musik: ${title}\n\n☁️ Cloupanz`);

  await fetch(`${TELEGRAM_API}/sendAudio`, { method: "POST", body: form });
}

// ==========================================
// 3. MEDIA SCRAPERS (TikWM & Multi-Engine IG)
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
    type: isSlide ? "photo" : "video",
    title: d.title || "TikTok Media",
    images: isSlide ? d.images : [],
    videoUrl: isSlide ? "" : (d.play || d.wmplay || ""),
    audioUrl: d.music || ""
  };
}

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
    title: root?.title || json?.title || "Instagram Media"
  };
}

async function downloadInstagram(rawUrl) {
  const cleanUrl = rawUrl.split("?")[0];
  const isReels = cleanUrl.includes("/reel/") || cleanUrl.includes("/reels/");

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
          type: isVid ? "video" : "photo",
          title: parsed.title,
          images: isVid ? [] : parsed.images,
          videoUrl: isVid ? (parsed.videos[0] || "") : ""
        };
      }
    }
  } catch {}

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
          type: isVid ? "video" : "photo",
          title: parsed2.title,
          images: isVid ? [] : parsed2.images,
          videoUrl: isVid ? (parsed2.videos[0] || "") : ""
        };
      }
    }
  } catch {}

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
          type: isVid ? "video" : "photo",
          title: parsed3.title,
          images: isVid ? [] : parsed3.images,
          videoUrl: isVid ? (parsed3.videos[0] || "") : ""
        };
      }
    }
  } catch {}

  throw new Error("Gagal mengambil media Instagram. Pastikan akun tidak di-private.");
}

// ==========================================
// 4. MAIN HANDLER & BOT LOGIC
// ==========================================

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).json({ ok: true, status: "online" });

  try {
    if (!TELEGRAM_TOKEN) {
      return res.status(500).json({ ok: false, error: "TELEGRAM_TOKEN belum dipasang." });
    }

    const update = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // Handle Callback Query (Klik Tombol Inline)
    if (update?.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message?.chat?.id;

      await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: cb.id })
      }).catch(() => {});

      if (cb.data === "btn_check_limit" && chatId) {
        const status = await getDownloadStatus(cb.from.id);
        const text = status.admin
          ? `👑 Status: Admin\n\nLimit: ∞ Tanpa batas`
          : `📊 Kuota Download Kamu:\n\nTerpakai: ${status.downloads}/${DAILY_LIMIT}\nSisa: ${status.remaining} kali`;
        await sendTextMessage(chatId, text);
      }

      return res.status(200).json({ ok: true });
    }

    const message = update?.message;
    if (!message?.chat?.id) return res.status(200).json({ ok: true });

    const chatId = message.chat.id;
    const user = message.from;
    const text = message.text?.trim() || "";

    await saveUser(user);

    // Command: /start
    if (text === "/start" || text.startsWith("/start ")) {
      const welcomeKeyboard = {
        inline_keyboard: [
          [{ text: "📊 Cek Sisa Limit", callback_data: "btn_check_limit" }]
        ]
      };

      await sendTextMessage(
        chatId,
        `Halo ${user?.first_name || "kak"} 👋\n\nKirim link TikTok atau Instagram untuk mengunduh media secara instan.\n\n📌 Limit: ${DAILY_LIMIT}/hari`,
        welcomeKeyboard
      );
      return res.status(200).json({ ok: true });
    }

    // Command: /help
    if (text === "/help") {
      await sendTextMessage(
        chatId,
        `📖 Panduan Penggunaan\n\n1. Tempel link postingan TikTok atau Instagram.\n2. Bot akan mendownload dan mengirimkan medianya secara otomatis.\n\n/limit - Cek kuota download\n/admin <PIN> - Aktivasi akses admin tanpa batas`
      );
      return res.status(200).json({ ok: true });
    }

    // Command: /limit atau /me
    if (text === "/limit" || text === "/me") {
      const status = await getDownloadStatus(user.id);
      const limitMsg = status.admin
        ? `👑 Admin Cloupanz\n\nLimit: ∞ Tanpa batas`
        : `📊 Kuota Download Cloupanz\n\nPenggunaan hari ini: ${status.downloads}/${DAILY_LIMIT}\nSisa kuota: ${status.remaining} kali`;

      await sendTextMessage(chatId, limitMsg);
      return res.status(200).json({ ok: true });
    }

    // Command: /admin <PIN>
    if (text.startsWith("/admin ")) {
      const pin = text.slice(7).trim();
      const result = await claimAdmin({ ...user, __adminPin: pin });

      await sendTextMessage(
        chatId,
        result.ok ? `👑 Akses Admin Berhasil Diaktifkan!\n\nKamu sekarang memiliki akses tanpa batas kuota.` : `❌ ${result.message}`
      );
      return res.status(200).json({ ok: true });
    }

    // Command: /stats (Khusus Admin)
    if (text === "/stats") {
      const admin = await isAdmin(user.id);
      if (!admin) {
        await sendTextMessage(chatId, "❌ Perintah ini khusus admin.");
        return res.status(200).json({ ok: true });
      }

      const dbUrl = `${firestoreBase()}/users?key=${FIREBASE_API_KEY}`;
      const resp = await fetch(dbUrl);
      const dbData = await resp.json();
      const userDocs = dbData.documents || [];

      let totalDownloads = 0;
      for (const item of userDocs) {
        totalDownloads += Number(item?.fields?.downloads?.integerValue || 0);
      }

      await sendTextMessage(
        chatId,
        `📊 Statistik Cloupanz\n\n👥 Total Pengguna: ${userDocs.length}\n📥 Total Download Hari Ini: ${totalDownloads}\n👑 Status Admin: Aktif`
      );
      return res.status(200).json({ ok: true });
    }

    if (!text) return res.status(200).json({ ok: true });

    const isTikTok = text.includes("tiktok.com");
    const isInstagram = text.includes("instagram.com") || text.includes("instagr.am");

    if (!isTikTok && !isInstagram) {
      await sendTextMessage(chatId, "❌ Kirim link TikTok atau Instagram yang valid.");
      return res.status(200).json({ ok: true });
    }

    // Cek Batas Limit
    const status = await getDownloadStatus(user.id);
    if (!status.admin && status.remaining <= 0) {
      await sendTextMessage(chatId, `❌ Kuota download harian kamu sudah habis (${DAILY_LIMIT}/${DAILY_LIMIT}).\n\nCoba lagi besok atau hubungi admin.`);
      return res.status(200).json({ ok: true });
    }

    // 1. Pesan Awal Progress (0%)
    const initMsg = await sendTextMessage(
      chatId,
      `⏳ Menghubungkan ke server...\n\n[░░░░░░░░░░] 0%\n\n☁️ Cloupanz`
    );
    const progressMsgId = initMsg?.result?.message_id;

    // 2. Update Progress Scraping (35%)
    if (progressMsgId) {
      await updateProgress(chatId, progressMsgId, 35, "Mengambil metadata media...");
    }

    const media = isTikTok ? await downloadTikTok(text) : await downloadInstagram(text);

    // 3. Update Progress Unduh Buffer (70%)
    if (progressMsgId) {
      await updateProgress(chatId, progressMsgId, 70, "Memproses file media...");
    }

    // 4. Update Progress Pengiriman (95%)
    if (progressMsgId) {
      await updateProgress(chatId, progressMsgId, 95, "Mengunggah ke Telegram...");
    }

    if (media.type === "photo" && media.images.length > 0) {
      await sendPhotos(chatId, media.images, media.title);

      if (media.audioUrl) {
        await sendAudio(chatId, media.audioUrl, media.title).catch(() => {});
      }
    } else if (media.type === "video" && media.videoUrl) {
      await sendVideo(chatId, media.videoUrl, media.title);
    } else {
      throw new Error("Media tidak ditemukan.");
    }

    if (!status.admin) {
      await addDownload(user);
    }

    // Hapus pesan progress setelah berhasil
    if (progressMsgId) {
      await deleteMessage(chatId, progressMsgId);
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("WEBHOOK ERROR:", error);
    if (req.body?.message?.chat?.id) {
      await sendTextMessage(req.body.message.chat.id, `❌ Gagal mengambil media: ${error.message}`);
    }
    return res.status(200).json({ ok: false, error: error.message });
  }
        }
