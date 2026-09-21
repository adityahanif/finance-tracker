import { NextResponse } from "next/server";
import { parseFreeText } from "../../../lib/gemini";
import {
  appendTransaction, updateTransactionById, deleteTransactionById,
  getAllTransactions, clearCachedAnalysis, monthKeyOf,
  getCategories, getSetting, findIdByPrefix, findTransactionById,
} from "../../../lib/sheets";
import { kategoriValid } from "../../../lib/categories";
import { randomUUID } from "crypto";

const TELEGRAM_API = (token) => `https://api.telegram.org/bot${token}`;

async function sendMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  await fetch(`${TELEGRAM_API(token)}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

function rupiah(n) {
  return "Rp" + Math.round(n).toLocaleString("id-ID");
}

// Otorisasi: hanya username yang terdaftar di TELEGRAM_ALLOWED_USERNAMES yang
// boleh pakai bot. Kalau env var ini kosong/tidak diisi, bot tetap terbuka
// untuk siapa saja (supaya tidak tiba-tiba mengunci diri sendiri kalau lupa set).
function isAuthorized(msg) {
  const allowed = (process.env.TELEGRAM_ALLOWED_USERNAMES || "")
    .split(",")
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return true;
  const username = (msg.from?.username || "").toLowerCase();
  return username && allowed.includes(username);
}

async function handleRingkasan(chatId) {
  const bulan = new Date().toISOString().slice(0, 7);
  const semua = await getAllTransactions();
  const bulanIni = semua.filter((t) => monthKeyOf(t.tanggal) === bulan);
  const masuk = bulanIni.filter((t) => t.jenis === "pemasukan").reduce((s, t) => s + t.jumlah, 0);
  const keluar = bulanIni.filter((t) => t.jenis === "pengeluaran").reduce((s, t) => s + t.jumlah, 0);
  await sendMessage(
    chatId,
    `Ringkasan bulan ini:\nPemasukan: ${rupiah(masuk)}\nPengeluaran: ${rupiah(keluar)}\nSaldo bersih: ${rupiah(masuk - keluar)}`
  );
}

async function handleHapus(chatId, idInput) {
  if (!idInput) return sendMessage(chatId, "Format: /hapus [id]");
  const fullId = await findIdByPrefix(idInput);
  if (!fullId) {
    return sendMessage(chatId, `ID "${idInput}" tidak ditemukan atau cocok dengan lebih dari satu transaksi. Cek ID lengkapnya di dashboard/tab Transaksi.`);
  }
  const deleted = await deleteTransactionById(fullId);
  if (deleted) {
    if (deleted.tanggal) await clearCachedAnalysis(monthKeyOf(deleted.tanggal));
    await sendMessage(chatId, `Transaksi ${idInput} dihapus.`);
  } else {
    await sendMessage(chatId, `ID ${idInput} tidak ditemukan.`);
  }
}

function parseEditCommand(rawText) {
  const cleaned = rawText.replace(/^\/edit\s*/i, "").trim();
  if (!cleaned) return { idInput: null, patch: {} };

  const firstSpace = cleaned.search(/\s/);
  if (firstSpace === -1) {
    return { idInput: cleaned, patch: {} };
  }

  const idInput = cleaned.slice(0, firstSpace).trim();
  const rest = cleaned.slice(firstSpace).trim();

  const patch = {};
  const regex = /(tanggal|jenis|jumlah|kategori|deskripsi)\s*=\s*(?:"([^"]*)"|'([^']*)'|((?:(?!\s+(?:tanggal|jenis|jumlah|kategori|deskripsi)\s*=).)+))/gi;
  let match;
  while ((match = regex.exec(rest)) !== null) {
    const key = match[1].toLowerCase();
    const val = (match[2] ?? match[3] ?? match[4] ?? "").trim();
    patch[key] = val;
  }

  if (Object.keys(patch).length === 0) {
    const pairs = rest.split(/\s+/);
    for (const p of pairs) {
      const [k, ...v] = p.split("=");
      if (!k || v.length === 0) continue;
      patch[k.trim().toLowerCase()] = v.join("=").trim();
    }
  }

  return { idInput, patch };
}

// Format: /edit <id> jumlah=20000 kategori=Makanan & Minuman deskripsi=ojek
async function handleEdit(chatId, rawText) {
  const { idInput, patch } = parseEditCommand(rawText);
  if (!idInput || Object.keys(patch).length === 0) {
    return sendMessage(
      chatId,
      "Format: /edit [id] field=nilai\nContoh:\n/edit ab12cd kategori=Makanan & Minuman\n/edit ab12cd jumlah=20000 deskripsi=beli nasi padang"
    );
  }
  const fullId = await findIdByPrefix(idInput);
  if (!fullId) {
    return sendMessage(chatId, `ID "${idInput}" tidak ditemukan atau cocok dengan lebih dari satu transaksi.`);
  }

  const existing = await findTransactionById(fullId);
  if (!existing) return sendMessage(chatId, `ID ${idInput} tidak ditemukan.`);

  if (patch.jumlah !== undefined) {
    const n = Number(patch.jumlah);
    if (!n || n <= 0) return sendMessage(chatId, "Jumlah harus angka positif.");
    patch.jumlah = n;
  }
  const effectiveJenis = patch.jenis || existing.jenis;
  const effectiveKategori = patch.kategori || existing.kategori;
  if (patch.jenis || patch.kategori) {
    const kategoriMap = await getCategories();
    if (!kategoriValid(effectiveJenis, effectiveKategori, kategoriMap)) {
      return sendMessage(chatId, `Kategori "${effectiveKategori}" tidak valid untuk jenis "${effectiveJenis}".`);
    }
  }
  const updated = await updateTransactionById(fullId, patch);
  if (!updated) return sendMessage(chatId, `ID ${idInput} tidak ditemukan.`);
  await clearCachedAnalysis(monthKeyOf(updated.tanggal));
  if (existing.tanggal && monthKeyOf(existing.tanggal) !== monthKeyOf(updated.tanggal)) {
    await clearCachedAnalysis(monthKeyOf(existing.tanggal));
  }
  await sendMessage(chatId, `Transaksi ${idInput} diperbarui.`);
}

async function handlePesanBebas(chatId, teks) {
  const kategoriMap = await getCategories();
  const model = await getSetting("gemini_parse_model", process.env.GEMINI_PARSE_MODEL || "gemini-3.5-flash-lite");

  let hasil;
  try {
    hasil = await parseFreeText(teks, kategoriMap, model);
  } catch (err) {
    return sendMessage(chatId, "Gagal memproses pesan, coba lagi sebentar lagi.");
  }

  if (hasil.error || !hasil.transaksi || hasil.transaksi.length === 0) {
    return sendMessage(chatId, hasil.error || "Pesan kurang jelas. Sertakan jumlah dan keterangan transaksinya ya.");
  }

  const validTransaksi = (hasil.transaksi || []).filter((t) => Number(t.jumlah) > 0);
  if (validTransaksi.length === 0) {
    return sendMessage(chatId, "Nominal transaksi tidak valid atau bernilai 0. Sertakan jumlah dengan jelas ya.");
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const ringkasanBaris = [];
  for (const t of validTransaksi) {
    const jenis = t.jenis === "pemasukan" ? "pemasukan" : "pengeluaran";
    const kategori = kategoriValid(jenis, t.kategori, kategoriMap) ? t.kategori : "Lainnya";
    const tx = {
      id: randomUUID(),
      tanggal: t.tanggal || today,
      jenis,
      jumlah: Number(t.jumlah),
      kategori,
      deskripsi: t.deskripsi || teks,
      chat_asli: teks,
      sumber_input: "telegram",
      timestamp_input: new Date().toISOString(),
    };
    await appendTransaction(tx);
    await clearCachedAnalysis(monthKeyOf(tx.tanggal));
    // ID pendek (8 karakter) ditampilkan untuk /edit & /hapus — cukup dicocokkan
    // sebagai prefix, tidak perlu ID lengkap.
    ringkasanBaris.push(
      `${jenis === "pemasukan" ? "+" : "-"}${rupiah(tx.jumlah)} — ${tx.kategori} (${tx.deskripsi}) [id:${tx.id.slice(0, 8)}]`
    );
  }
  await sendMessage(chatId, `Tercatat:\n${ringkasanBaris.join("\n")}`);
}

export async function POST(req) {
  const secretHeader = req.headers.get("x-telegram-bot-api-secret-token");
  if (secretHeader !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Token webhook tidak valid." }, { status: 401 });
  }

  const update = await req.json().catch(() => ({}));
  const msg = update.message;
  if (!msg || !msg.text) return NextResponse.json({ ok: true });

  const chatId = msg.chat.id;
  const teks = msg.text.trim();

  if (!isAuthorized(msg)) {
    await sendMessage(chatId, "Bot ini privat dan tidak bisa diakses oleh akun ini.");
    return NextResponse.json({ ok: true });
  }

  try {
    if (teks.startsWith("/ringkasan")) {
      await handleRingkasan(chatId);
    } else if (teks.startsWith("/hapus")) {
      const [, id] = teks.split(/\s+/);
      await handleHapus(chatId, id);
    } else if (teks.startsWith("/edit")) {
      await handleEdit(chatId, teks);
    } else if (teks.startsWith("/start")) {
      await sendMessage(chatId, "Halo! Kirim pesan seperti \"bakso 15rb\" untuk mencatat transaksi. Perintah lain: /ringkasan, /edit [id] field=nilai, /hapus [id].");
    } else {
      await handlePesanBebas(chatId, teks);
    }
  } catch (err) {
    console.error(err);
    await sendMessage(chatId, "Terjadi kesalahan di server, coba lagi sebentar lagi.");
  }

  return NextResponse.json({ ok: true });
}