import { NextResponse } from "next/server";
import { getAllTransactions, appendTransaction, clearCachedAnalysis, monthKeyOf, getCategories } from "../../../lib/sheets";
import { kategoriValid } from "../../../lib/categories";
import { randomUUID } from "crypto";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const bulan = searchParams.get("bulan"); // format YYYY-MM, opsional

  try {
    let data = await getAllTransactions();
    if (bulan) data = data.filter((t) => monthKeyOf(t.tanggal) === bulan);
    data.sort((a, b) => (a.tanggal < b.tanggal ? 1 : -1));
    return NextResponse.json({ transaksi: data });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { tanggal, jenis, jumlah, kategori, deskripsi } = body;

  // Validasi dasar (FR-20)
  if (!tanggal) return NextResponse.json({ error: "Tanggal wajib diisi." }, { status: 400 });
  if (jenis !== "pemasukan" && jenis !== "pengeluaran")
    return NextResponse.json({ error: "Jenis harus 'pemasukan' atau 'pengeluaran'." }, { status: 400 });
  const jumlahNum = Number(jumlah);
  if (!jumlahNum || jumlahNum <= 0)
    return NextResponse.json({ error: "Jumlah harus angka positif." }, { status: 400 });

  const kategoriMap = await getCategories();
  if (!kategori || !kategoriValid(jenis, kategori, kategoriMap))
    return NextResponse.json({ error: "Kategori wajib dipilih dari daftar yang tersedia." }, { status: 400 });

  const tx = {
    id: randomUUID(),
    tanggal,
    jenis,
    jumlah: jumlahNum,
    kategori,
    deskripsi: deskripsi || kategori,
    chat_asli: "",
    sumber_input: "website_form", // FR-17: tanpa AI, langsung tersimpan
    timestamp_input: new Date().toISOString(),
  };

  try {
    await appendTransaction(tx);
    await clearCachedAnalysis(monthKeyOf(tanggal)); // data berubah -> invalidasi cache analisis (FR-28)
    return NextResponse.json({ transaksi: tx }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
