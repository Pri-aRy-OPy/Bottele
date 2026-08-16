const ADMIN_PIN = process.env.ADMIN_PIN;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;

function firestoreBase() {
  return (
    `https://firestore.googleapis.com/v1/projects/` +
    `${FIREBASE_PROJECT_ID}` +
    `/databases/(default)/documents`
  );
}

function json(res, status, data) {
  return res.status(status).json(data);
}

/*
==================================================
 TOKEN ADMIN
==================================================
*/

function createToken() {
  const payload = {
    admin: true,
    exp: Date.now() + (24 * 60 * 60 * 1000)
  };

  return Buffer
    .from(JSON.stringify(payload))
    .toString("base64url");
}

function checkToken(token) {
  if (!token) return false;

  try {
    const payload = JSON.parse(
      Buffer
        .from(token, "base64url")
        .toString()
    );

    return (
      payload.admin === true &&
      Number(payload.exp) > Date.now()
    );

  } catch {
    return false;
  }
}

/*
==================================================
 FIREBASE USERS
==================================================
*/

async function getUsers() {

  if (
    !FIREBASE_PROJECT_ID ||
    !FIREBASE_API_KEY
  ) {
    throw new Error(
      "Firebase belum dikonfigurasi di Environment Variables."
    );
  }

  const url =
    `${firestoreBase()}/users` +
    `?key=${FIREBASE_API_KEY}`;

  const response = await fetch(url);

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      "Gagal mengambil data Firebase."
    );
  }

  return data.documents || [];
}

/*
==================================================
 HANDLER
==================================================
*/

export default async function handler(req, res) {

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  /*
  ================================================
  LOGIN
  ================================================
  */

  if (req.method === "POST") {

    try {

      if (!ADMIN_PIN) {
        return json(res, 500, {
          ok: false,
          message:
            "ADMIN_PIN belum dipasang di Vercel."
        });
      }

      const pin =
        String(req.body?.pin || "").trim();

      if (!pin) {
        return json(res, 400, {
          ok: false,
          message: "PIN wajib diisi."
        });
      }

      if (pin !== String(ADMIN_PIN)) {
        return json(res, 401, {
          ok: false,
          message: "PIN salah."
        });
      }

      const token =
        createToken();

      return json(res, 200, {
        ok: true,
        token,
        message: "Login berhasil."
      });

    } catch (error) {

      console.error(
        "ADMIN LOGIN ERROR:",
        error
      );

      return json(res, 500, {
        ok: false,
        message:
          error?.message ||
          "Terjadi kesalahan server."
      });
    }
  }

  /*
  ================================================
  CHECK SESSION
  ================================================
  */

  if (req.method === "GET") {

    const auth =
      req.headers.authorization || "";

    const token =
      auth.startsWith("Bearer ")
        ? auth.slice(7)
        : "";

    if (!checkToken(token)) {

      return json(res, 401, {
        ok: false,
        message: "Session tidak valid."
      });
    }

    /*
    ==============================================
    USERS
    ==============================================
    */

    try {

      const users =
        await getUsers();

      return json(res, 200, {
        ok: true,
        users
      });

    } catch (error) {

      console.error(
        "ADMIN USERS ERROR:",
        error
      );

      return json(res, 500, {
        ok: false,
        message:
          error?.message ||
          "Gagal mengambil users."
      });
    }
  }

  return json(res, 405, {
    ok: false,
    message: "Method tidak diizinkan."
  });
}
