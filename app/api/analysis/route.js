import { NextResponse } from "next/server";
import { getAllTransactions, getCachedAnalysis, setCachedAnalysis, monthKeyOf, getSetting } from "../../../lib/sheets";
import { generateAnalysis } from "../../../lib/gemini";

function prevMonthKey(bulan) {
  const [y, m] = bulan.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function buildAggregate(bulan) {
  const semua = await getAllTransactions();
  const prev = prevMonthKey(bulan);

  const byCategory = (mk) => {
    const map = {};
    semua
      .filter((t) => monthKeyOf(t.tanggal) === mk && t.jenis === "pengeluaran")
      .forEach((t) => { map[t.kategori] = (map[t.kategori] || 0) + t.jumlah; });
    return map;
  };

  const totalJenis = (mk, jenis) =>
    semua.filter((t) => monthKeyOf(t.tanggal) === mk && t.jenis === jenis).reduce((s, t) => s + t.jumlah, 0);

  return {
    bulan_berjalan: bulan,
    bulan_sebelumnya: prev,
    pengeluaran_per_kategori_bulan_berjalan: byCategory(bulan),
    pengeluaran_per_kategori_bulan_sebelumnya: byCategory(prev),
    total_pemasukan_bulan_berjalan: totalJenis(bulan, "pemasukan"),
    total_pengeluaran_bulan_berjalan: totalJenis(bulan, "pengeluaran"),
  };
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const bulan = searchParams.get("bulan");
  if (!bulan) return NextResponse.json({ error: "Parameter 'bulan' wajib diisi." }, { status: 400 });

  try {
    const cached = await getCachedAnalysis(bulan);
    return NextResponse.json({ teks: cached?.teks || null, updated_at: cached?.updated_at || null });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const { bulan } = await req.json().catch(() => ({}));
  if (!bulan) return NextResponse.json({ error: "Parameter 'bulan' wajib diisi." }, { status: 400 });

  try {
    const agregat = await buildAggregate(bulan);
    const model = await getSetting("gemini_analysis_model", process.env.GEMINI_ANALYSIS_MODEL || "gemini-3.8-flash");
    const teks = await generateAnalysis(agregat, model);
    await setCachedAnalysis(bulan, teks);
    return NextResponse.json({ teks });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
