import { NextResponse } from "next/server";
import { parseFreeText } from "../../../lib/gemini";
import {
  appendTransaction, updateTransactionById, deleteTransactionById,
  getAllTransactions, clearCachedAnalysis, monthKeyOf,
  getCategories, getSetting,
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

async function handleHapus(chatId, id) {
  if (!id) return sendMessage(chatId, "Format: /hapus [id]");
  const ok = await deleteTransactionById(id);
  await sendMessage(chatId, ok ? `Transaksi ${id} dihapus.` : `ID ${id} tidak ditemukan.`);
}

// Format: /edit <id> jumlah=20000 kategori=Transportasi deskripsi=ojek
async function handleEdit(chatId, args) {
  const [id, ...pairs] = args;
  if (!id || pairs.length === 0) {
    return sendMessage(chatId, "Format: /edit [id] field=nilai (contoh: /edit ab12cd jumlah=20000 kategori=Transportasi)");
  }
  const patch = {};
  for (const p of pairs) {
    const [k, ...rest] = p.split("=");
    if (!k || rest.length === 0) continue;
    patch[k.trim()] = rest.join("=").trim();
  }
  if (patch.jumlah) patch.jumlah = Number(patch.jumlah);
  if (patch.jenis && patch.kategori) {
    const kategoriMap = await getCategories();
    if (!kategoriValid(patch.jenis, patch.kategori, kategoriMap)) {
      return sendMessage(chatId, `Kategori "${patch.kategori}" tidak valid untuk jenis "${patch.jenis}".`);
    }
  }
  const updated = await updateTransactionById(id, patch);
  if (!updated) return sendMessage(chatId, `ID ${id} tidak ditemukan.`);
  await clearCachedAnalysis(monthKeyOf(updated.tanggal));
  await sendMessage(chatId, `Transaksi ${id} diperbarui.`);
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

  // FR-7: jika AI gagal parsing, minta klarifikasi, jangan simpan sembarangan
  if (hasil.error || !hasil.transaksi || hasil.transaksi.length === 0) {
    return sendMessage(chatId, hasil.error || "Pesan kurang jelas. Sertakan jumlah dan keterangan transaksinya ya.");
  }

  const ringkasanBaris = [];
  for (const t of hasil.transaksi) {
    const jenis = t.jenis === "pemasukan" ? "pemasukan" : "pengeluaran";
    const kategori = kategoriValid(jenis, t.kategori, kategoriMap) ? t.kategori : "Lainnya";
    const tx = {
      id: randomUUID(),
      tanggal: t.tanggal || new Date().toISOString().slice(0, 10),
      jenis,
      jumlah: Number(t.jumlah) || 0,
      kategori,
      deskripsi: t.deskripsi || teks,
      chat_asli: teks,
      sumber_input: "telegram",
      timestamp_input: new Date().toISOString(),
    };
    await appendTransaction(tx);
    await clearCachedAnalysis(monthKeyOf(tx.tanggal));
    ringkasanBaris.push(
      `${jenis === "pemasukan" ? "+" : "-"}${rupiah(tx.jumlah)} — ${tx.kategori} (${tx.deskripsi}) [id:${tx.id.slice(0, 6)}]`
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

  try {
    if (teks.startsWith("/ringkasan")) {
      await handleRingkasan(chatId);
    } else if (teks.startsWith("/hapus")) {
      const [, id] = teks.split(/\s+/);
      await handleHapus(chatId, id);
    } else if (teks.startsWith("/edit")) {
      const [, ...args] = teks.split(/\s+/);
      await handleEdit(chatId, args);
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
