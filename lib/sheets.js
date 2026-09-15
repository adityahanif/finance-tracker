import { google } from "googleapis";
import { KATEGORI_PENGELUARAN_FALLBACK, KATEGORI_PEMASUKAN_FALLBACK } from "./categories";

const SHEET_TRANSAKSI = "Transaksi";
const SHEET_ANALISIS = "AnalisisCache";
const SHEET_KATEGORI = "Kategori";
const SHEET_SETTINGS = "Pengaturan";
const KOLOM = ["id", "tanggal", "jenis", "jumlah", "kategori", "deskripsi", "chat_asli", "sumber_input", "timestamp_input"];

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Kredensial Google Service Account belum diisi di environment variable.");
  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function sheetsClient() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

function sheetId() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEET_ID belum diisi di environment variable.");
  return id;
}

function rowToObj(row) {
  const obj = {};
  KOLOM.forEach((k, i) => { obj[k] = row[i] ?? ""; });
  obj.jumlah = Number(obj.jumlah) || 0;
  return obj;
}

function objToRow(obj) {
  return KOLOM.map((k) => (obj[k] === undefined || obj[k] === null ? "" : obj[k]));
}

// ---------------------------------------------------------------------------
// Transaksi
// ---------------------------------------------------------------------------

export async function getAllTransactions() {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${SHEET_TRANSAKSI}!A2:I`,
  });
  const rows = res.data.values || [];
  return rows.filter((r) => r[0]).map(rowToObj);
}

export async function appendTransaction(tx) {
  const sheets = sheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: `${SHEET_TRANSAKSI}!A:I`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [objToRow(tx)] },
  });
  return tx;
}

async function findRowNumberById(id) {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${SHEET_TRANSAKSI}!A2:A`,
  });
  const rows = res.data.values || [];
  const idx = rows.findIndex((r) => r[0] === id);
  if (idx === -1) return null;
  return idx + 2; // +2: offset header (baris 1) & index 0-based
}

export async function updateTransactionById(id, patch) {
  const rowNumber = await findRowNumberById(id);
  if (!rowNumber) return null;
  const sheets = sheetsClient();
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${SHEET_TRANSAKSI}!A${rowNumber}:I${rowNumber}`,
  });
  const existing = rowToObj((current.data.values || [[]])[0]);
  const updated = { ...existing, ...patch, id };
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId(),
    range: `${SHEET_TRANSAKSI}!A${rowNumber}:I${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [objToRow(updated)] },
  });
  return updated;
}

export async function deleteTransactionById(id) {
  const rowNumber = await findRowNumberById(id);
  if (!rowNumber) return false;
  const sheets = sheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId() });
  const sheet = meta.data.sheets.find((s) => s.properties.title === SHEET_TRANSAKSI);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId(),
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: sheet.properties.sheetId,
            dimension: "ROWS",
            startIndex: rowNumber - 1,
            endIndex: rowNumber,
          },
        },
      }],
    },
  });
  return true;
}

export function monthKeyOf(tanggal) {
  return (tanggal || "").slice(0, 7);
}

// ---------------------------------------------------------------------------
// Kategori (tab "Kategori": kolom A=jenis, B=kategori)
// ---------------------------------------------------------------------------

let _catCache = null;
let _catCacheAt = 0;
const CAT_CACHE_MS = 60_000; // 1 menit

export async function getCategories() {
  const now = Date.now();
  if (_catCache && now - _catCacheAt < CAT_CACHE_MS) return _catCache;

  try {
    const sheets = sheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId(),
      range: `${SHEET_KATEGORI}!A2:B`,
    });
    const rows = res.data.values || [];
    const result = { pengeluaran: [], pemasukan: [] };
    rows.forEach(([jenis, kategori]) => {
      const key = (jenis || "").trim().toLowerCase();
      if (kategori && (key === "pengeluaran" || key === "pemasukan")) {
        result[key].push(kategori.trim());
      }
    });
    // Kalau tab kosong/belum diisi, pakai fallback supaya aplikasi tetap jalan.
    if (result.pengeluaran.length === 0) result.pengeluaran = KATEGORI_PENGELUARAN_FALLBACK;
    if (result.pemasukan.length === 0) result.pemasukan = KATEGORI_PEMASUKAN_FALLBACK;

    _catCache = result;
    _catCacheAt = now;
    return result;
  } catch {
    // Tab belum dibuat / error akses -> tetap jalan pakai fallback.
    return { pengeluaran: KATEGORI_PENGELUARAN_FALLBACK, pemasukan: KATEGORI_PEMASUKAN_FALLBACK };
  }
}

// ---------------------------------------------------------------------------
// Pengaturan (tab "Pengaturan": kolom A=key, B=value) — dipakai untuk nama
// model Gemini yang bisa diganti dari dashboard tanpa deploy ulang.
// ---------------------------------------------------------------------------

export async function getSetting(key, fallback) {
  try {
    const sheets = sheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId(),
      range: `${SHEET_SETTINGS}!A2:B`,
    });
    const rows = res.data.values || [];
    const row = rows.find((r) => r[0] === key);
    return row?.[1] || fallback;
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
      requestBody: { values: [[key, value]] },
    });
  } else {
    const rowNumber = idx + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId(),
      range: `${SHEET_SETTINGS}!A${rowNumber}:B${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[key, value]] },
    });
  }
}

// ---------------------------------------------------------------------------
// Cache analisis AI (FR-28: jangan generate ulang tiap dashboard dibuka)
// ---------------------------------------------------------------------------

export async function getCachedAnalysis(bulan) {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${SHEET_ANALISIS}!A2:C`,
  });
  const rows = res.data.values || [];
  const row = rows.find((r) => r[0] === bulan);
  return row ? { bulan: row[0], teks: row[1], updated_at: row[2] } : null;
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
      requestBody: { values: [[bulan, teks, now]] },
    });
  } else {
    const rowNumber = idx + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId(),
      range: `${SHEET_ANALISIS}!A${rowNumber}:C${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[bulan, teks, now]] },
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
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId() });
  const sheet = meta.data.sheets.find((s) => s.properties.title === SHEET_ANALISIS);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId(),
    requestBody: {
      requests: [{
        deleteDimension: {
          range: { sheetId: sheet.properties.sheetId, dimension: "ROWS", startIndex: idx + 1, endIndex: idx + 2 },
        },
      }],
    },
  });
}
