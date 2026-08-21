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

async function saveUser(user, refBy = null) {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY || !user?.id) return;

  try {
    const id = userDoc(user.id);
    const old = await getUser(id);
    const date = today();

    let downloads = Number(old?.fields?.downloads?.integerValue || 0);
    let bonusLimit = Number(old?.fields?.bonus_limit?.integerValue || 0);
    let referrals = Number(old?.fields?.referrals?.integerValue || 0);
    let lastReset = old?.fields?.last_reset?.stringValue || "";

    if (lastReset !== date) {
      downloads = 0;
      bonusLimit = 0;
      lastReset = date;
    }

    if (!old && refBy && refBy !== String(user.id)) {
      await addReferralBonus(refBy, user.first_name || "Teman");
    }

    const data = {
      fields: {
        telegram_id: { stringValue: String(user.id) },
        username: { stringValue: user.username || "" },
        first_name: { stringValue: user.first_name || "" },
        last_name: { stringValue: user.last_name || "" },
        downloads: { integerValue: String(downloads) },
        bonus_limit: { integerValue: String(bonusLimit) },
        referrals: { integerValue: String(referrals) },
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

async function addReferralBonus(referrerId, newUserName) {
  try {
    const ref = await getUser(referrerId);
    if (!ref) return;

    let bonus = Number(ref?.fields?.bonus_limit?.integerValue || 0) + 3;
    let refs = Number(ref?.fields?.referrals?.integerValue || 0) + 1;

    const url = `${firestoreBase()}/users/${encodeURIComponent(referrerId)}?key=${FIREBASE_API_KEY}`;
    await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          ...ref.fields,
          bonus_limit: { integerValue: String(bonus) },
          referrals: { integerValue: String(refs) }
        }
      })
    });

    await sendTextMessage(
      referrerId,
      `🎉 <b>Selamat!</b> <b>${newUserName}</b> bergabung lewat tautanmu.\n🎁 Kuota download kamu bertambah <b>+3 limit</b> hari ini!`
    );
  } catch (err) {
    console.error("Add Referral Bonus Error:", err);
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
    const userId = String(user.id);
    const userUrl = `${firestoreBase()}/users/${encodeURIComponent(userId)}?key=${FIREBASE_API_KEY}`;
    const old = await getUser(userId);

    await fetch(userUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          ...(old?.fields || {}),
          telegram_id: { stringValue: userId },
          username: { stringValue: user.username || "" },
          first_name: { stringValue: user.first_name || "" },
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
    return { downloads: 0, bonusLimit: 0, maxLimit: DAILY_LIMIT, remaining: DAILY_LIMIT, admin: false };
  }

  const admin = user?.fields?.is_admin?.booleanValue === true;
  if (admin) {
    return { downloads: 0, bonusLimit: 0, maxLimit: Infinity, remaining: Infinity, admin: true };
  }

  let downloads = Number(user?.fields?.downloads?.integerValue || 0);
  let bonusLimit = Number(user?.fields?.bonus_limit?.integerValue || 0);
  const lastReset = user?.fields?.last_reset?.stringValue || "";

  if (lastReset !== today()) {
    downloads = 0;
    bonusLimit = 0;
  }

  const totalMax = DAILY_LIMIT + bonusLimit;

  return {
    downloads,
    bonusLimit,
    maxLimit: totalMax,
    remaining: Math.max(totalMax - downloads, 0),
    admin: false
  };
}

async function addDownload(user) {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY) return;
  try {
    const old = await getUser(user.id);
    let downloads = Number(old?.fields?.downloads?.integerValue || 0) + 1;

    const url = `${firestoreBase()}/users/${encodeURIComponent(String(user.id))}?key=${FIREBASE_API_KEY}`;
    await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          ...old.fields,
          downloads: { integerValue: String(downloads) },
          last_seen: { timestampValue: new Date().toISOString() }
        }
      })
    });
  } catch (err) {
    console.error("AddDownload Error:", err);
  }
}

// ==========================================
// 2. TELEGRAM SENDER & PROGRESS
// ==========================================

async function sendTextMessage(chatId, text, replyMarkup = null) {
  const body = { chat_id: chatId, text, parse_mode: "HTML" };
  if (replyMarkup) body.reply_markup = replyMarkup;

  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return await res.json().catch(() => ({}));
}

async function editMessage(chatId, messageId, text, replyMarkup = null) {
  const body = { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML" };
  if (replyMarkup) body.reply_markup = replyMarkup;

  await fetch(`${TELEGRAM_API}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).catch(() => {});
}

async function updateProgress(chatId, messageId, percent, statusText) {
  const totalBars = 10;
  const filledBars = Math.min(10, Math.max(0, Math.round((percent / 100) * totalBars)));
  const emptyBars = totalBars - filledBars;
  const bar = "█".repeat(filledBars) + "░".repeat(emptyBars);

  await editMessage(
    chatId,
    messageId,
    `⏳ <b>${statusText}</b>\n\n<code>[${bar}] ${percent}%</code>\n\n☁️ <b>Cloupanz</b>`
  );
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
  form.append("caption", `🎬 <b>${title}</b>\n\n☁️ Cloupanz`);
  form.append("parse_mode", "HTML");
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
    form.append("caption", `🖼️ <b>${title}</b>\n\n☁️ Cloupanz`);
    form.append("parse_mode", "HTML");

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
      caption: index === 0 ? `🖼️ <b>${title}</b> (${urls.length} foto)\n\n☁️ Cloupanz` : undefined,
      parse_mode: "HTML"
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
  form.append("caption", `🎵 <b>Musik:</b> ${title}\n\n☁️ Cloupanz`);
  form.append("parse_mode", "HTML");

  await fetch(`${TELEGRAM_API}/sendAudio`, { method: "POST", body: form });
}

// ==========================================
// 3. MEDIA SCRAPERS (TikTok, Instagram, Pinterest)
// ==========================================

async function downloadTikTok(url) {
  const res = await fetch("https://www.tikwm.com/api/?url=" + encodeURIComponent(url), {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }
  });
  const json = await res.json();
  if (json.code !== 0 || !json.data) throw new Error(json.msg || "Gagal mengambil data TikTok.");

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

async function downloadInstagram(rawUrl) {
  const cleanUrl = rawUrl.split("?")[0];
  const isReels = cleanUrl.includes("/reel/") || cleanUrl.includes("/reels/");

  // Engine 1: ahm7xmakki
  try {
    const api1 = `https://ahm7xmakki.com/api/alldl?url=` + encodeURIComponent(cleanUrl);
    const res1 = await fetch(api1, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } });
    if (res1.ok) {
      const json1 = await res1.json();
      const root = json1?.data?.mediaInfo || json1?.mediaInfo || json1?.data || json1?.result || json1;
      const title = root?.title || json1?.title || "Instagram Media";

      // 1. Ekstraksi Video
      let videoUrl = root?.videoUrl || root?.video_url || "";
      if (!videoUrl && root?.url && (String(root?.type).includes("video") || isReels || root?.url.includes(".mp4"))) {
        videoUrl = root.url;
      }

      // 2. Ekstraksi Carousel / Slides
      let images = [];
      const carousels = root?.carousel || root?.carouselMedia || root?.carousel_media || root?.medias || root?.images || root?.photos;
      if (Array.isArray(carousels) && carousels.length > 0) {
        for (const item of carousels) {
          const u = typeof item === "string" ? item : (item?.url || item?.display_url || item?.imageUrl || item?.image_url);
          if (u && typeof u === "string" && u.startsWith("http") && !images.includes(u)) {
            images.push(u);
          }
        }
      }

      // Prioritas 1: Video murni atau Reels
      if (videoUrl || isReels) {
        return {
          type: "video",
          title,
          images: [],
          videoUrl: videoUrl || root?.url || ""
        };
      }

      // Prioritas 2: Slide Foto Banyak
      if (images.length > 0) {
        return {
          type: "photo",
          title,
          images,
          videoUrl: ""
        };
      }

      // Prioritas 3: Foto Tunggal
      const singleImg = root?.image || root?.display_url || root?.thumbnail || root?.thumbnailUrl || root?.url;
      if (singleImg && typeof singleImg === "string" && singleImg.startsWith("http")) {
        return {
          type: "photo",
          title,
          images: [singleImg],
          videoUrl: ""
        };
      }
    }
  } catch (err) {
    console.error("IG Engine 1 error:", err);
  }

  // Engine 2: siputzx fallback
  try {
    const api2 = `https://api.siputzx.my.id/api/d/ig?url=` + encodeURIComponent(cleanUrl);
    const res2 = await fetch(api2, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } });
    if (res2.ok) {
      const json2 = await res2.json();
      const data = json2?.data;
      if (Array.isArray(data) && data.length > 0) {
        const vidItem = data.find(d => d.type === "video" || (d.url && d.url.includes(".mp4")));
        if (vidItem || isReels) {
          return {
            type: "video",
            title: "Instagram Video",
            images: [],
            videoUrl: vidItem?.url || data[0]?.url || ""
          };
        } else {
          return {
            type: "photo",
            title: "Instagram Photo",
            images: data.map(d => d.url || d.thumbnail).filter(Boolean),
            videoUrl: ""
          };
        }
      }
    }
  } catch (err) {
    console.error("IG Engine 2 error:", err);
  }

  throw new Error("Gagal mengambil media Instagram. Pastikan akun tidak di-private.");
}

async function downloadPinterest(url) {
  try {
    const api = `https://api.siputzx.my.id/api/d/pinterest?url=` + encodeURIComponent(url);
    const res = await fetch(api, { headers: { "User-Agent": "Mozilla/5.0" } });
    const json = await res.json();

    if (json.status && json.data) {
      const mediaUrl = json.data.url || json.data.image || json.data.video;
      const isVideo = mediaUrl?.includes(".mp4") || Boolean(json.data.video);

      return {
        type: isVideo ? "video" : "photo",
        title: json.data.title || "Pinterest Media",
        images: isVideo ? [] : [mediaUrl],
        videoUrl: isVideo ? mediaUrl : ""
      };
    }
  } catch {}

  const fallback = `https://ahm7xmakki.com/api/alldl?url=` + encodeURIComponent(url);
  const fRes = await fetch(fallback, { headers: { "User-Agent": "Mozilla/5.0" } });
  const fJson = await fRes.json();
  const root = fJson?.data?.mediaInfo || fJson?.data || fJson;

  const vid = root?.videoUrl || root?.video_url || "";
  const img = root?.image || root?.thumbnail || root?.url || "";

  if (!vid && !img) throw new Error("Gagal mengambil media Pinterest.");

  return {
    type: vid ? "video" : "photo",
    title: root?.title || "Pinterest Media",
    images: vid ? [] : [img],
    videoUrl: vid
  };
}

// ==========================================
// 4. INLINE KEYBOARDS
// ==========================================

function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "📊 Cek Sisa Limit", callback_data: "btn_limit" },
        { text: "🎁 Tambah Limit Gratis", callback_data: "btn_tambah_limit" }
      ],
      [
        { text: "📖 Panduan / Cara Pakai", callback_data: "btn_help" }
      ]
    ]
  };
}

function getBackKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🔙 Kembali ke Menu", callback_data: "btn_main_menu" }]
    ]
  };
}

// ==========================================
// 5. MAIN HANDLER
// ==========================================

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).json({ ok: true, status: "online" });

  try {
    if (!TELEGRAM_TOKEN) {
      return res.status(500).json({ ok: false, error: "TELEGRAM_TOKEN belum dipasang." });
    }

    const update = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // A. Inline Query (@bot <link>)
    if (update?.inline_query) {
      const q = update.inline_query;
      const queryText = q.query.trim();

      const results = [];
      if (queryText.startsWith("http")) {
        results.push({
          type: "article",
          id: "dl_media",
          title: "📥 Download Media Ini",
          description: queryText,
          input_message_content: {
            message_text: queryText
          }
        });
      }

      await fetch(`${TELEGRAM_API}/answerInlineQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inline_query_id: q.id,
          results,
          cache_time: 1
        })
      }).catch(() => {});

      return res.status(200).json({ ok: true });
    }

    // B. Callback Query (Klik Tombol Inline)
    if (update?.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message?.chat?.id;
      const messageId = cb.message?.message_id;
      const userId = cb.from?.id;

      await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: cb.id })
      }).catch(() => {});

      if (cb.data === "btn_limit" && chatId) {
        const status = await getDownloadStatus(userId);
        const text = status.admin
          ? `👑 <b>Status Akun: Admin</b>\n\nLimit: ∞ <i>Tanpa Batas</i>`
          : `📊 <b>Status Kuota Kamu</b>\n\n• Kuota Dasar: <b>${DAILY_LIMIT}</b>/hari\n• Bonus Tambahan: <b>+${status.bonusLimit}</b>\n• Terpakai Hari Ini: <b>${status.downloads}</b>\n• Sisa Kuota: <b>${status.remaining}</b> kali unduh`;

        await editMessage(chatId, messageId, text, getBackKeyboard());
      }

      if (cb.data === "btn_tambah_limit" && chatId) {
        const botInfo = await fetch(`${TELEGRAM_API}/getMe`).then(r => r.json());
        const botUsername = botInfo?.result?.username || "bot";
        const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;

        const text = `🎁 <b>Cara Menambah Kuota Download Gratis</b>\n\nBagikan tautan referral kamu ke teman atau grup. Setiap ada 1 teman yang bergabung menggunakan linkmu, kamu langsung mendapatkan <b>+3 kuota download harian</b>!\n\n🔗 <b>Tautan Referral Kamu:</b>\n<code>${refLink}</code>\n\n<i>Klik link di atas untuk menyalin.</i>`;

         const shareKeyboard = {
          inline_keyboard: [
            [{ text: "🚀 Bagikan ke Teman", url: `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent("Download video TikTok, Instagram, dan Pinterest gratis tanpa watermark di bot ini:")}` }],
            [{ text: "🔙 Kembali", callback_data: "btn_main_menu" }]
          ]
        };

        await editMessage(chatId, messageId, text, shareKeyboard);
      }

      if (cb.data === "btn_help" && chatId) {
        const text = `📖 <b>Panduan Penggunaan Cloupanz</b>\n\n1. Salin tautan postingan dari <b>TikTok</b>, <b>Instagram</b>, atau <b>Pinterest</b>.\n2. Kirim/tempel link tersebut ke ruang obrolan ini.\n3. Bot akan langsung memproses dan mengirimkan media aslinya (Video/Album Foto/Musik).\n\n💡 <i>Kamu juga bisa mengetik <code>@namabot &lt;link&gt;</code> di grup mana saja!</i>`;
        await editMessage(chatId, messageId, text, getBackKeyboard());
      }

      if (cb.data === "btn_main_menu" && chatId) {
        const text = `Halo <b>${cb.from?.first_name || "kak"}</b> 👋\n\nKirimkan tautan <b>TikTok</b>, <b>Instagram</b>, atau <b>Pinterest</b> untuk mengunduh media.`;
        await editMessage(chatId, messageId, text, getMainMenuKeyboard());
      }

      return res.status(200).json({ ok: true });
    }

    const message = update?.message;
    if (!message?.chat?.id) return res.status(200).json({ ok: true });

    const chatId = message.chat.id;
    const user = message.from;
    const text = message.text?.trim() || "";

    let refBy = null;
    if (text.startsWith("/start ref_")) {
      refBy = text.split("ref_")[1]?.trim();
    }

    await saveUser(user, refBy);

    if (text.startsWith("/start")) {
      await sendTextMessage(
        chatId,
        `Halo <b>${user?.first_name || "kak"}</b> 👋\n\nKirimkan tautan <b>TikTok</b>, <b>Instagram</b>, atau <b>Pinterest</b> untuk mengunduh media secara instan tanpa watermark.`,
        getMainMenuKeyboard()
      );
      return res.status(200).json({ ok: true });
    }

    if (text === "/help") {
      await sendTextMessage(
        chatId,
        `📖 <b>Panduan Penggunaan Cloupanz</b>\n\nCukup kirimkan link postingan TikTok, Instagram, atau Pinterest ke sini.`,
        getMainMenuKeyboard()
      );
      return res.status(200).json({ ok: true });
    }

    // Fitur Admin Tersembunyi
    if (text.startsWith("/admin ")) {
      const pin = text.slice(7).trim();
      const result = await claimAdmin({ ...user, __adminPin: pin });
      await sendTextMessage(
        chatId,
        result.ok ? `👑 <b>Akses Admin Aktif!</b>\n\nKamu sekarang memiliki kuota tanpa batas dan dapat menggunakan fitur <code>/broadcast</code>.` : `❌ ${result.message}`
      );
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith("/broadcast ")) {
      const admin = await isAdmin(user.id);
      if (!admin) return res.status(200).json({ ok: true });

      const broadcastMsg = text.slice(11).trim();
      if (!broadcastMsg) {
        await sendTextMessage(chatId, "❌ Masukkan pesan yang ingin di-broadcast.\nContoh: <code>/broadcast Halo semua!</code>");
        return res.status(200).json({ ok: true });
      }

      const dbUrl = `${firestoreBase()}/users?key=${FIREBASE_API_KEY}`;
      const resp = await fetch(dbUrl);
      const dbData = await resp.json();
      const userDocs = dbData.documents || [];

      await sendTextMessage(chatId, `⏳ Memulai broadcast ke <b>${userDocs.length}</b> pengguna...`);

      let successCount = 0;
      for (const doc of userDocs) {
        const targetId = doc.fields?.telegram_id?.stringValue;
        if (targetId) {
          const sent = await sendTextMessage(targetId, `📢 <b>PENGUMUMAN</b>\n\n${broadcastMsg}`);
          if (sent?.ok) successCount++;
        }
      }

      await sendTextMessage(chatId, `✅ Broadcast selesai!\nBerhasil terkirim ke <b>${successCount}/${userDocs.length}</b> pengguna.`);
      return res.status(200).json({ ok: true });
    }

    if (!text) return res.status(200).json({ ok: true });

    const isTikTok = text.includes("tiktok.com");
    const isInstagram = text.includes("instagram.com") || text.includes("instagr.am");
    const isPinterest = text.includes("pinterest.com") || text.includes("pin.it");

    if (!isTikTok && !isInstagram && !isPinterest) {
      await sendTextMessage(
        chatId,
        "❌ <b>Tautan tidak didukung.</b>\n\nKirimkan link yang valid dari:\n• 🎵 TikTok\n• 📸 Instagram\n• 📌 Pinterest",
        getMainMenuKeyboard()
      );
      return res.status(200).json({ ok: true });
    }

    const status = await getDownloadStatus(user.id);
    if (!status.admin && status.remaining <= 0) {
      await sendTextMessage(
        chatId,
        `❌ <b>Kuota download harian kamu telah habis!</b>\n\nKamu bisa mendapatkan <b>+3 kuota gratis</b> sekarang dengan membagikan link referral ke teman.`,
        {
          inline_keyboard: [
            [{ text: "🎁 Tambah Kuota Gratis Sekarang", callback_data: "btn_tambah_limit" }]
          ]
        }
      );
      return res.status(200).json({ ok: true });
    }

    const initMsg = await sendTextMessage(chatId, `⏳ <b>Menghubungkan...</b>\n\n<code>[░░░░░░░░░░] 0%</code>\n\n☁️ Cloupanz`);
    const progressMsgId = initMsg?.result?.message_id;

    if (progressMsgId) {
      await updateProgress(chatId, progressMsgId, 30, "Mengekstrak media...");
    }

    let media;
    if (isTikTok) media = await downloadTikTok(text);
    else if (isInstagram) media = await downloadInstagram(text);
    else if (isPinterest) media = await downloadPinterest(text);

    if (progressMsgId) {
      await updateProgress(chatId, progressMsgId, 70, "Mengunduh file...");
    }

    if (progressMsgId) {
      await updateProgress(chatId, progressMsgId, 95, "Mengirim ke chat...");
    }

    if (media.type === "photo" && media.images.length > 0) {
      await sendPhotos(chatId, media.images, media.title);
      if (media.audioUrl) {
        await sendAudio(chatId, media.audioUrl, media.title).catch(() => {});
      }
    } else if (media.type === "video" && media.videoUrl) {
      await sendVideo(chatId, media.videoUrl, media.title);
    } else {
      throw new Error("Media tidak ditemukan atau postingan bersifat privat.");
    }

    if (!status.admin) {
      await addDownload(user);
    }

    if (progressMsgId) {
      await deleteMessage(chatId, progressMsgId);
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("WEBHOOK ERROR:", error);
    if (req.body?.message?.chat?.id) {
      await sendTextMessage(req.body.message.chat.id, `❌ <b>Gagal mengunduh:</b> ${error.message}`);
    }
    return res.status(200).json({ ok: false, error: error.message });
  }
}                                                                                                                                    
