import { NextResponse } from "next/server";
import {
  getAllTransactions,
  getSaldoAwalOverrides,
  setSaldoAwalOverride,
  clearCachedAnalysis,
} from "../../../lib/sheets";
import { hitungRingkasanBulan, isValidMonthKey } from "../../../lib/saldo";

async function ringkasan(bulan) {
  const [transaksi, overrides] = await Promise.all([
    getAllTransactions(),
    getSaldoAwalOverrides(),
  ]);
  return hitungRingkasanBulan(transaksi, overrides, bulan);
}

// GET /api/saldo-awal?bulan=YYYY-MM
// -> { bulan, saldo_awal, saldo_awal_otomatis, saldo_awal_sumber,
//      total_pemasukan, total_pengeluaran, saldo_akhir }
// total_pemasukan/total_pengeluaran murni transaksi bulan itu;
// saldo_awal TIDAK termasuk di dalamnya.
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const bulan = searchParams.get("bulan");
  if (!isValidMonthKey(bulan)) {
    return NextResponse.json({ error: "Parameter 'bulan' harus format YYYY-MM." }, { status: 400 });
  }
  try {
    return NextResponse.json(await ringkasan(bulan));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/saldo-awal  { bulan: "YYYY-MM", saldo_awal: angka | null }
// saldo_awal angka (termasuk 0) = override manual bulan itu.
// saldo_awal null / "" = hapus override, kembali ke otomatis.
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const bulan = body.bulan;
  if (!isValidMonthKey(bulan)) {
    return NextResponse.json({ error: "Field 'bulan' harus format YYYY-MM." }, { status: 400 });
  }
  try {
    if (body.saldo_awal === null || body.saldo_awal === undefined || body.saldo_awal === "") {
      await setSaldoAwalOverride(bulan, null);
    } else {
      const num = Number(body.saldo_awal);
      if (!Number.isFinite(num)) {
        return NextResponse.json({ error: "Saldo awal harus berupa angka." }, { status: 400 });
      }
      await setSaldoAwalOverride(bulan, num);
    }
    await clearCachedAnalysis(bulan).catch(() => {});
    return NextResponse.json(await ringkasan(bulan));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
