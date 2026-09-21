import { NextResponse } from "next/server";
import { parseFreeText } from "../../../lib/gemini";
import {
  appendTransaction, clearCachedAnalysis, monthKeyOf,
  getCategories, getSetting,
} from "../../../lib/sheets";
import { kategoriValid } from "../../../lib/categories";
import { randomUUID } from "crypto";

export async function POST(req) {
  const { text } = await req.json().catch(() => ({}));
  if (!text || !text.trim()) {
    return NextResponse.json({ error: "Teks tidak boleh kosong." }, { status: 400 });
  }

  const kategoriMap = await getCategories();
  const model = await getSetting("gemini_parse_model", process.env.GEMINI_PARSE_MODEL || "gemini-3.5-flash-lite");

  let hasil;
  try {
    hasil = await parseFreeText(text.trim(), kategoriMap, model);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  // FR-7 (setara website): jika ambigu, minta klarifikasi, jangan simpan sembarangan
  if (hasil.error || !hasil.transaksi || hasil.transaksi.length === 0) {
    return NextResponse.json(
      { error: hasil.error || "Pesan tidak jelas, coba tulis ulang." },
      { status: 422 }
    );
  }

  const validTransaksi = (hasil.transaksi || []).filter((t) => Number(t.jumlah) > 0);
  if (validTransaksi.length === 0) {
    return NextResponse.json(
      { error: "Nominal transaksi tidak valid atau bernilai 0. Mohon sebutkan jumlah dengan jelas." },
      { status: 422 }
    );
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const disimpan = [];
  for (const t of validTransaksi) {
    const jenis = t.jenis === "pemasukan" ? "pemasukan" : "pengeluaran";
    const kategori = kategoriValid(jenis, t.kategori, kategoriMap) ? t.kategori : "Lainnya";
    const tx = {
      id: randomUUID(),
      tanggal: t.tanggal || today,
      jenis,
      jumlah: Number(t.jumlah),
      kategori,
      deskripsi: t.deskripsi || text.trim(),
      chat_asli: text.trim(),
      sumber_input: "website_quick_add",
      timestamp_input: new Date().toISOString(),
    };
    await appendTransaction(tx);
    await clearCachedAnalysis(monthKeyOf(tx.tanggal));
    disimpan.push(tx);
  }

  return NextResponse.json({ transaksi: disimpan }, { status: 201 });
}
