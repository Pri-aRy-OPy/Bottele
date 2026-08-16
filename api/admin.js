import crypto from "crypto";

const ADMIN_PIN = process.env.ADMIN_PIN || "";
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "";
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || "";
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 6);

function firestoreBase() {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function sign(value) {
  return crypto
    .createHmac("sha256", ADMIN_PIN)
    .update(value)
    .digest("hex");
}

function createToken() {
  const exp = Date.now() + 12 * 60 * 60 * 1000;
  return `${exp}.${sign(String(exp))}`;
}

function verifyToken(token) {
  try {
    if (!token) return false;

    const parts = token.split(".");
    if (parts.length !== 2) return false;

    const [exp, sig] = parts;

    if (Date.now() > Number(exp)) return false;

    const expected = sign(exp);

    return crypto.timingSafeEqual(
      Buffer.from(sig),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

function auth(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return false;
  }

  return verifyToken(header.slice(7));
}

function firestoreValue(value) {
  if (!value) return "";

  if (value.stringValue !== undefined) {
    return value.stringValue;
  }

  if (value.integerValue !== undefined) {
    return Number(value.integerValue);
  }

  if (value.booleanValue !== undefined) {
    return value.booleanValue;
  }

  if (value.timestampValue !== undefined) {
    return value.timestampValue;
  }

  return "";
}

function convertDocument(doc) {
  const fields = doc.fields || {};

  return {
    id: doc.name?.split("/").pop() || "",
    telegram_id: firestoreValue(fields.telegram_id),
    username: firestoreValue(fields.username),
    first_name: firestoreValue(fields.first_name),
    last_name: firestoreValue(fields.last_name),
    downloads: Number(firestoreValue(fields.downloads) || 0),
    last_reset: firestoreValue(fields.last_reset),
    is_admin: Boolean(firestoreValue(fields.is_admin)),
    last_seen: firestoreValue(fields.last_seen)
  };
}

async function firestoreFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {
      error: text
    };
  }

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      data?.error ||
      `Firebase HTTP ${response.status}`
    );
  }

  return data;
}

async function getAllUsers() {
  let users = [];
  let pageToken = "";

  do {
    let url =
      `${firestoreBase()}/users` +
      `?key=${encodeURIComponent(FIREBASE_API_KEY)}` +
      `&pageSize=300`;

    if (pageToken) {
      url += `&pageToken=${encodeURIComponent(pageToken)}`;
    }

    const data = await firestoreFetch(url);

    if (Array.isArray(data.documents)) {
      users.push(...data.documents.map(convertDocument));
    }

    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return users;
}

async function getConfig() {
  const url =
    `${firestoreBase()}/config/bot` +
    `?key=${encodeURIComponent(FIREBASE_API_KEY)}`;

  try {
    const data = await firestoreFetch(url);

    return convertDocument(data);
  } catch {
    return null;
  }
}

async function saveConfig(data) {
  const url =
    `${firestoreBase()}/config/bot` +
    `?key=${encodeURIComponent(FIREBASE_API_KEY)}`;

  return firestoreFetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      fields: data
    })
  });
}

function checkConfig() {
  if (!ADMIN_PIN) {
    throw new Error("ADMIN_PIN belum dipasang di Vercel.");
  }

  if (!FIREBASE_PROJECT_ID) {
    throw new Error("FIREBASE_PROJECT_ID belum dipasang di Vercel.");
  }

  if (!FIREBASE_API_KEY) {
    throw new Error("FIREBASE_API_KEY belum dipasang di Vercel.");
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      service: "Cloupanz Admin API"
    });
  }

  try {
    checkConfig();

    const body = req.body || {};
    const action = body.action;

    if (action === "login") {
      const pin = String(body.pin || "").trim();

      if (!pin) {
        return res.status(400).json({
          ok: false,
          error: "PIN wajib diisi."
        });
      }

      if (pin !== ADMIN_PIN) {
        return res.status(401).json({
          ok: false,
          error: "PIN salah."
        });
      }

      return res.status(200).json({
        ok: true,
        token: createToken(),
        expiresIn: 43200
      });
    }

    if (!auth(req)) {
      return res.status(401).json({
        ok: false,
        error: "Sesi admin tidak valid atau sudah expired."
      });
    }

    if (action === "dashboard") {
      const users = await getAllUsers();

      let dailyDownloads = 0;
      let admins = 0;
      let activeToday = 0;

      for (const user of users) {
        if (user.is_admin) {
          admins++;
        }

        if (user.last_reset === today()) {
          dailyDownloads += Number(user.downloads || 0);
        }

        if (user.last_seen) {
          const time = new Date(user.last_seen).getTime();

          if (
            !Number.isNaN(time) &&
            Date.now() - time < 24 * 60 * 60 * 1000
          ) {
            activeToday++;
          }
        }
      }

      const config = await getConfig();

      return res.status(200).json({
        ok: true,
        stats: {
          users: users.length,
          dailyDownloads,
          activeToday,
          admins,
          dailyLimit: DAILY_LIMIT,
          status: "online"
        },
        config
      });
    }

    if (action === "users") {
      const users = await getAllUsers();

      users.sort((a, b) => {
        const aa = new Date(a.last_seen || 0).getTime();
        const bb = new Date(b.last_seen || 0).getTime();

        return bb - aa;
      });

      return res.status(200).json({
        ok: true,
        users
      });
    }

    if (action === "config") {
      const config = await getConfig();

      return res.status(200).json({
        ok: true,
        config
      });
    }

    if (action === "save-config") {
      const input = body.config || {};

      const data = {
        bot_name: {
          stringValue: String(input.bot_name || "Cloupanz")
        },
        daily_limit: {
          integerValue: String(
            Number(input.daily_limit || DAILY_LIMIT)
          )
        },
        updated_at: {
          timestampValue: new Date().toISOString()
        }
      };

      await saveConfig(data);

      return res.status(200).json({
        ok: true,
        message: "Konfigurasi berhasil disimpan."
      });
    }

    return res.status(400).json({
      ok: false,
      error: "Action tidak dikenal."
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Server error."
    });
  }
      }
