import { google } from "googleapis";
import {
  KATEGORI_PENGELUARAN_FALLBACK,
  KATEGORI_PEMASUKAN_FALLBACK,
} from "./categories";

const SHEET_TRANSAKSI = "Transaksi";
const SHEET_ANALISIS = "AnalisisCache";
const SHEET_KATEGORI = "Kategori";
const SHEET_SETTINGS = "Pengaturan";

const KOLOM = [
  "id",
  "tanggal",
  "jenis",
  "jumlah",
  "kategori",
  "deskripsi",
  "chat_asli",
  "sumber_input",
  "timestamp_input",
];

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!email || !key) {
    throw new Error(
      "Kredensial Google Service Account belum diisi di environment variable."
    );
  }

  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function sheetsClient() {
  return google.sheets({
    version: "v4",
    auth: getAuth(),
  });
}

function sheetId() {
  const id = process.env.GOOGLE_SHEET_ID;

  if (!id) {
    throw new Error("GOOGLE_SHEET_ID belum diisi di environment variable.");
  }

  return id;
}

function rowToObj(row) {
  const obj = {};

  KOLOM.forEach((k, i) => {
    obj[k] = row[i] ?? "";
  });

  obj.jumlah = Number(obj.jumlah) || 0;
  // Di sheet jenis ditulis Title Case (Pengeluaran/Pemasukan); logika aplikasi
  // memakai lowercase, jadi dinormalkan saat dibaca.
  obj.jenis = String(obj.jenis).trim().toLowerCase();

  return obj;
}

// Kolom jenis di sheet ditulis Title Case.
function jenisTitle(jenis) {
  const key = String(jenis || "").trim().toLowerCase();
  if (key === "pengeluaran") return "Pengeluaran";
  if (key === "pemasukan") return "Pemasukan";
  return jenis;
}

function objToRow(obj) {
  return KOLOM.map((k) =>
    obj[k] === undefined || obj[k] === null ? "" : obj[k]
  );
}

// ---------------------------------------------------------------------------
// Cache Transaksi
// ---------------------------------------------------------------------------

let _transactionsCache = null;
let _transactionsCacheAt = 0;
let _transactionsCachePromise = null;

const TRANSACTION_CACHE_MS = 10_000; // 10 detik

function clearTransactionsCache() {
  _transactionsCache = null;
  _transactionsCacheAt = 0;
}

// ---------------------------------------------------------------------------
// Transaksi
// ---------------------------------------------------------------------------

export async function getAllTransactions() {
  const now = Date.now();

  // Pakai cache yang masih valid.
  if (
    _transactionsCache &&
    now - _transactionsCacheAt < TRANSACTION_CACHE_MS
  ) {
    return _transactionsCache;
  }

  // Kalau ada request pembacaan yang sedang berjalan,
  // semua pemanggil menunggu request yang sama.
  if (_transactionsCachePromise) {
    return _transactionsCachePromise;
  }

  _transactionsCachePromise = (async () => {
    try {
      const sheets = sheetsClient();

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId(),
        range: `${SHEET_TRANSAKSI}!A2:I`,
      });

      const rows = res.data.values || [];
      const data = rows.filter((r) => r[0]).map(rowToObj);

      _transactionsCache = data;
      _transactionsCacheAt = Date.now();

      return data;
    } finally {
      _transactionsCachePromise = null;
    }
  })();

  return _transactionsCachePromise;
}

export async function appendTransaction(tx) {
  const sheets = sheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: `${SHEET_TRANSAKSI}!A:I`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [objToRow({ ...tx, jenis: jenisTitle(tx.jenis) })],
    },
  });

  // Data berubah → cache transaksi harus dibuang.
  clearTransactionsCache();

  return tx;
}

export async function findTransactionById(id) {
  if (!id) return null;
  const data = await getAllTransactions();
  const targetId = String(id).trim();
  const index = data.findIndex((t) => String(t.id || "").trim() === targetId);
  if (index === -1) return null;
  return data[index];
}

async function findRowNumberById(id) {
  if (!id) return null;
  const sheets = sheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${SHEET_TRANSAKSI}!A2:A`,
  });

  const rows = res.data.values || [];
  const targetId = String(id).trim();
  const idx = rows.findIndex((r) => String(r?.[0] || "").trim() === targetId);

  if (idx === -1) return null;

  return idx + 2;
}

// Cari ID transaksi lengkap dari potongan awalnya (prefix). Dipakai supaya
// user tidak perlu ketik/salin UUID lengkap di command Telegram.
export async function findIdByPrefix(prefix) {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${SHEET_TRANSAKSI}!A2:A`,
  });
  const rows = res.data.values || [];
  const matches = rows.map((r) => r[0]).filter((id) => id && id.startsWith(prefix));
  return matches.length === 1 ? matches[0] : null; // null kalau tidak ketemu ATAU ambigu (>1 cocok)
}

export async function updateTransactionById(id, patch) {
  const rowNumber = await findRowNumberById(id);

  if (!rowNumber) return null;

  const sheets = sheetsClient();

  const current = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${SHEET_TRANSAKSI}!A${rowNumber}:I${rowNumber}`,
  });

  const existing = rowToObj(
    (current.data.values || [[]])[0]
  );

  const updated = {
    ...existing,
    ...patch,
    id,
  };

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId(),
    range: `${SHEET_TRANSAKSI}!A${rowNumber}:I${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [objToRow({ ...updated, jenis: jenisTitle(updated.jenis) })],
    },
  });

  // Data berubah → cache transaksi harus dibuang.
  clearTransactionsCache();

  return updated;
}

export async function deleteTransactionById(id) {
  const rowNumber = await findRowNumberById(id);

  if (!rowNumber) return null;

  const sheets = sheetsClient();

  const current = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${SHEET_TRANSAKSI}!A${rowNumber}:I${rowNumber}`,
  });

  const deleted = rowToObj(
    (current.data.values || [[]])[0]
  );

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId(),
  });

  const sheet = meta.data.sheets.find(
    (s) => s.properties.title === SHEET_TRANSAKSI
  );

  if (!sheet) {
    throw new Error(`Sheet "${SHEET_TRANSAKSI}" tidak ditemukan.`);
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId(),
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheet.properties.sheetId,
              dimension: "ROWS",
              startIndex: rowNumber - 1,
              endIndex: rowNumber,
            },
          },
        },
      ],
    },
  });

  // Data berubah → cache transaksi harus dibuang.
  clearTransactionsCache();

  return deleted;
}

export function monthKeyOf(tanggal) {
  return (tanggal || "").slice(0, 7);
}

// ---------------------------------------------------------------------------
// Kategori
// tab "Kategori": kolom A=jenis, B=kategori
// ---------------------------------------------------------------------------

let _catCache = null;
let _catCacheAt = 0;

const CAT_CACHE_MS = 60_000; // 1 menit

export async function getCategories() {
  const now = Date.now();

  if (_catCache && now - _catCacheAt < CAT_CACHE_MS) {
    return _catCache;
  }

  try {
    const sheets = sheetsClient();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId(),
      range: `${SHEET_KATEGORI}!A2:B`,
    });

    const rows = res.data.values || [];

    const result = {
      pengeluaran: [],
      pemasukan: [],
    };

    rows.forEach(([jenis, kategori]) => {
      const key = (jenis || "").trim().toLowerCase();

      if (
        kategori &&
        (key === "pengeluaran" || key === "pemasukan")
      ) {
        result[key].push(kategori.trim());
      }
    });

    if (result.pengeluaran.length === 0) {
      result.pengeluaran = KATEGORI_PENGELUARAN_FALLBACK;
    }

    if (result.pemasukan.length === 0) {
      result.pemasukan = KATEGORI_PEMASUKAN_FALLBACK;
    }

    _catCache = result;
    _catCacheAt = now;

    return result;
  } catch {
    return {
      pengeluaran: KATEGORI_PENGELUARAN_FALLBACK,
      pemasukan: KATEGORI_PEMASUKAN_FALLBACK,
    };
  }
}

export async function addCategory(jenis, kategori) {
  const key = (jenis || "").trim().toLowerCase();
  if (key !== "pengeluaran" && key !== "pemasukan") {
    throw new Error("Jenis harus Pengeluaran atau Pemasukan.");
  }

  const nama = (kategori || "").trim();
  if (!nama) {
    throw new Error("Nama kategori tidak boleh kosong.");
  }

  const current = await getCategories();
  if (current[key].some((k) => k.toLowerCase() === nama.toLowerCase())) {
    throw new Error(`Kategori "${nama}" sudah ada di daftar ${key}.`);
  }

  const sheets = sheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: `${SHEET_KATEGORI}!A:B`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[key === "pengeluaran" ? "Pengeluaran" : "Pemasukan", nama]],
    },
  });

  _catCache = null;
  _catCacheAt = 0;

  return nama;
}

export async function deleteCategory(jenis, kategori) {
  const key = (jenis || "").trim().toLowerCase();
  if (key !== "pengeluaran" && key !== "pemasukan") {
    throw new Error("Jenis harus Pengeluaran atau Pemasukan.");
  }

  const nama = (kategori || "").trim();

  const sheets = sheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${SHEET_KATEGORI}!A2:B`,
  });

  const rows = res.data.values || [];
  const idx = rows.findIndex(
    (r) =>
      (r[0] || "").trim().toLowerCase() === key &&
      (r[1] || "").trim() === nama
  );

  if (idx === -1) return false;

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId(),
  });

  const sheet = meta.data.sheets.find(
    (s) => s.properties.title === SHEET_KATEGORI
  );

  if (!sheet) {
    throw new Error(`Sheet "${SHEET_KATEGORI}" tidak ditemukan.`);
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId(),
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheet.properties.sheetId,
              dimension: "ROWS",
              startIndex: idx + 1,
              endIndex: idx + 2,
            },
          },
        },
      ],
    },
  });

  _catCache = null;
  _catCacheAt = 0;

  return true;
}

// ---------------------------------------------------------------------------
// Pengaturan
// tab "Pengaturan": kolom A=key, B=value
// ---------------------------------------------------------------------------
let _settingsCache = null;
let _settingsCacheAt = 0;
const SETTINGS_CACHE_MS = 60_000;

export async function getSetting(key, fallback) {
  const now = Date.now();

  if (
    _settingsCache &&
    now - _settingsCacheAt < SETTINGS_CACHE_MS
  ) {
    return _settingsCache[key] || fallback;
  }

  try {
    const sheets = sheetsClient();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId(),
      range: `${SHEET_SETTINGS}!A2:B`,
    });

    const rows = res.data.values || [];
    const settings = {};

    rows.forEach(([k, value]) => {
      if (k) settings[k] = value || "";
    });

    _settingsCache = settings;
    _settingsCacheAt = Date.now();

    return settings[key] || fallback;
  } catch {
    return fallback;
  }
}

export async function setSetting(key, value) {
  const sheets = sheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${SHEET_SETTINGS}!A2:A`,
  });

  const rows = res.data.values || [];
  const idx = rows.findIndex((r) => r[0] === key);

  if (idx === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId(),
      range: `${SHEET_SETTINGS}!A:B`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[key, value]],
      },
    });
  } else {
    const rowNumber = idx + 2;

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId(),
      range: `${SHEET_SETTINGS}!A${rowNumber}:B${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[key, value]],
      },
    });
  }

  _settingsCache = null;
  _settingsCacheAt = 0;
}

// ---------------------------------------------------------------------------
// Cache Analisis AI
// ---------------------------------------------------------------------------

export async function getCachedAnalysis(bulan) {
  const sheets = sheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${SHEET_ANALISIS}!A2:C`,
  });

  const rows = res.data.values || [];
  const row = rows.find((r) => r[0] === bulan);

  return row
    ? {
        bulan: row[0],
        teks: row[1],
        updated_at: row[2],
      }
    : null;
}

export async function setCachedAnalysis(bulan, teks) {
  const sheets = sheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${SHEET_ANALISIS}!A2:A`,
  });

  const rows = res.data.values || [];
  const idx = rows.findIndex((r) => r[0] === bulan);
  const now = new Date().toISOString();

  if (idx === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId(),
      range: `${SHEET_ANALISIS}!A:C`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[bulan, teks, now]],
      },
    });
  } else {
    const rowNumber = idx + 2;

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId(),
      range: `${SHEET_ANALISIS}!A${rowNumber}:C${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[bulan, teks, now]],
      },
    });
  }
}

export async function clearCachedAnalysis(bulan) {
  const sheets = sheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${SHEET_ANALISIS}!A2:A`,
  });

  const rows = res.data.values || [];
  const idx = rows.findIndex((r) => r[0] === bulan);

  if (idx === -1) return;

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId(),
  });

  const sheet = meta.data.sheets.find(
    (s) => s.properties.title === SHEET_ANALISIS
  );

  if (!sheet) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId(),
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheet.properties.sheetId,
              dimension: "ROWS",
              startIndex: idx + 1,
              endIndex: idx + 2,
            },
          },
        },
      ],
    },
  });
}
