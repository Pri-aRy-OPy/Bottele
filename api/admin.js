const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID;

const FIREBASE_API_KEY =
  process.env.FIREBASE_API_KEY;

const ADMIN_PIN =
  process.env.ADMIN_PIN;


/* ==========================================
   RESPONSE
========================================== */

function json(data, status = 200) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "Content-Type":
          "application/json",
        "Cache-Control":
          "no-store"
      }
    }
  );

}


/* ==========================================
   FIRESTORE BASE
========================================== */

function firestoreBase() {

  return (
    "https://firestore.googleapis.com/v1/projects/" +
    encodeURIComponent(
      FIREBASE_PROJECT_ID
    ) +
    "/databases/(default)/documents"
  );

}


/* ==========================================
   FIRESTORE GET COLLECTION
========================================== */

async function getUsers() {

  if (
    !FIREBASE_PROJECT_ID ||
    !FIREBASE_API_KEY
  ) {

    throw new Error(
      "Firebase belum dikonfigurasi."
    );

  }


  let documents = [];
  let pageToken = "";


  /*
   * Ambil semua halaman Firestore.
   */
  do {

    let url =
      `${firestoreBase()}/users?pageSize=300&key=${encodeURIComponent(FIREBASE_API_KEY)}`;

    if (pageToken) {

      url +=
        `&pageToken=${encodeURIComponent(pageToken)}`;

    }


    const response =
      await fetch(url, {
        cache: "no-store"
      });


    const data =
      await response.json();


    if (!response.ok) {

      throw new Error(
        data?.error?.message ||
        "Firestore gagal mengambil users."
      );

    }


    if (
      Array.isArray(
        data.documents
      )
    ) {

      documents.push(
        ...data.documents
      );

    }


    pageToken =
      data.nextPageToken || "";

  } while (pageToken);


  return documents;

}


/* ==========================================
   FIRESTORE GET CONFIG
========================================== */

async function getConfig() {

  const url =
    `${firestoreBase()}/config/bot` +
    `?key=${encodeURIComponent(FIREBASE_API_KEY)}`;


  const response =
    await fetch(url, {
      cache: "no-store"
    });


  if (!response.ok) {

    return null;

  }


  return await response.json();

}


/* ==========================================
   FIRESTORE FIELD HELPERS
========================================== */

function stringField(fields, name) {

  return (
    fields?.[name]?.stringValue ||
    ""
  );

}


function integerField(fields, name) {

  return Number(
    fields?.[name]?.integerValue ||
    0
  );

}


function booleanField(fields, name) {

  return (
    fields?.[name]?.booleanValue === true
  );

}


function timestampField(fields, name) {

  return (
    fields?.[name]?.timestampValue ||
    null
  );

}


/* ==========================================
   CONVERT USER
========================================== */

function convertUser(document) {

  const fields =
    document.fields || {};


  const firstName =
    stringField(
      fields,
      "first_name"
    );

  const lastName =
    stringField(
      fields,
      "last_name"
    );


  const name =
    `${firstName} ${lastName}`
      .trim();


  return {

    telegramId:
      stringField(
        fields,
        "telegram_id"
      ) ||
      document.name
        ?.split("/")
        .pop() ||
      "",


    username:
      stringField(
        fields,
        "username"
      ),


    name:
      name || "Tanpa Nama",


    downloads:
      integerField(
        fields,
        "downloads"
      ),


    isAdmin:
      booleanField(
        fields,
        "is_admin"
      ),


    lastReset:
      stringField(
        fields,
        "last_reset"
      ),


    lastSeen:
      timestampField(
        fields,
        "last_seen"
      )

  };

}


/* ==========================================
   CHECK ADMIN PIN
========================================== */

function validPin(request) {

  if (!ADMIN_PIN) {

    return false;

  }


  const pin =
    request.headers.get(
      "x-admin-pin"
    );


  return (
    pin &&
    pin === ADMIN_PIN
  );

}


/* ==========================================
   MAIN
========================================== */

export default async function handler(
  request
) {

  try {

    const url =
      new URL(
        request.url
      );


    const action =
      url.searchParams.get(
        "action"
      );


    /* ======================================
       LOGIN
    ====================================== */

    if (
      action === "login"
    ) {

      if (
        request.method !== "POST"
      ) {

        return json(
          {
            ok: false,
            message:
              "Method tidak diizinkan."
          },
          405
        );

      }


      if (!ADMIN_PIN) {

        return json(
          {
            ok: false,
            message:
              "ADMIN_PIN belum diset di Vercel."
          },
          500
        );

      }


      if (
        !validPin(request)
      ) {

        return json(
          {
            ok: false,
            message:
              "PIN admin salah."
          },
          401
        );

      }


      return json({
        ok: true,
        message:
          "Login berhasil."
      });

    }


    /* ======================================
       SEMUA ACTION SELAIN LOGIN
       HARUS ADMIN
    ====================================== */

    if (
      !validPin(request)
    ) {

      return json(
        {
          ok: false,
          message:
            "Unauthorized."
        },
        401
      );

    }


    /* ======================================
       USERS
    ====================================== */

    if (
      action === "users"
    ) {

      if (
        request.method !== "GET"
      ) {

        return json(
          {
            ok: false,
            message:
              "Method tidak diizinkan."
          },
          405
        );

      }


      const [
        documents,
        config
      ] = await Promise.all([
        getUsers(),
        getConfig()
      ]);


      const users =
        documents.map(
          convertUser
        );


      /*
       * Urutkan user terbaru
       * di atas.
       */

      users.sort(
        (a, b) => {

          const dateA =
            a.lastSeen
              ? new Date(
                  a.lastSeen
                ).getTime()
              : 0;

          const dateB =
            b.lastSeen
              ? new Date(
                  b.lastSeen
                ).getTime()
              : 0;

          return dateB - dateA;

        }
      );


      const now =
        new Date();


      let todayUsers = 0;
      let totalDownloads = 0;


      users.forEach(
        user => {

          totalDownloads +=
            Number(
              user.downloads || 0
            );


          if (
            user.lastSeen
          ) {

            const date =
              new Date(
                user.lastSeen
              );


            if (
              date.toDateString() ===
              now.toDateString()
            ) {

              todayUsers++;

            }

          }

        }
      );


      const configFields =
        config?.fields || {};


      const adminId =
        stringField(
          configFields,
          "admin_id"
        );


      return json({

        ok: true,

        stats: {

          totalUsers:
            users.length,

          todayUsers,

          totalDownloads,

          adminExists:
            Boolean(adminId),

          adminId

        },

        users

      });

    }


    /* ======================================
       HEALTH
    ====================================== */

    if (
      action === "health"
    ) {

      return json({

        ok: true,

        service:
          "Cloupanz Admin API",

        firebase:
          Boolean(
            FIREBASE_PROJECT_ID &&
            FIREBASE_API_KEY
          ),

        admin:
          Boolean(ADMIN_PIN)

      });

    }


    return json(
      {
        ok: false,
        message:
          "Action tidak ditemukan."
      },
      404
    );


  } catch (error) {

    console.error(
      "ADMIN API ERROR:",
      error
    );


    return json(
      {
        ok: false,
        message:
          error?.message ||
          "Internal server error."
      },
      500
    );

  }

    }
