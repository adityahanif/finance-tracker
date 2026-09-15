import { NextResponse } from "next/server";
import { updateTransactionById, deleteTransactionById, clearCachedAnalysis, monthKeyOf, getCategories } from "../../../../lib/sheets";
import { kategoriValid } from "../../../../lib/categories";

export async function PATCH(req, { params }) {
  const patch = await req.json().catch(() => ({}));

  if (patch.jenis && patch.kategori) {
    const kategoriMap = await getCategories();
    if (!kategoriValid(patch.jenis, patch.kategori, kategoriMap)) {
      return NextResponse.json({ error: "Kategori tidak sesuai dengan jenis transaksi." }, { status: 400 });
    }
  }
  if (patch.jumlah !== undefined) {
    const n = Number(patch.jumlah);
    if (!n || n <= 0) return NextResponse.json({ error: "Jumlah harus angka positif." }, { status: 400 });
    patch.jumlah = n;
  }

  try {
    const updated = await updateTransactionById(params.id, patch);
    if (!updated) return NextResponse.json({ error: "Transaksi tidak ditemukan." }, { status: 404 });
    if (updated.tanggal) await clearCachedAnalysis(monthKeyOf(updated.tanggal));
    return NextResponse.json({ transaksi: updated });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(_req, { params }) {
  try {
    const ok = await deleteTransactionById(params.id);
    if (!ok) return NextResponse.json({ error: "Transaksi tidak ditemukan." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
