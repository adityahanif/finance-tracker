import { NextResponse } from "next/server";
import {
  updateTransactionById,
  deleteTransactionById,
  clearCachedAnalysis,
  monthKeyOf,
  getCategories,
  findTransactionById,
} from "../../../../lib/sheets";
import { kategoriValid } from "../../../../lib/categories";

export async function PATCH(req, { params }) {
  const resolvedParams = await params;
  const id = resolvedParams?.id;
  const patch = await req.json().catch(() => ({}));

  const existing = await findTransactionById(id);
  if (!existing) return NextResponse.json({ error: "Transaksi tidak ditemukan." }, { status: 404 });

  const effectiveJenis = patch.jenis || existing.jenis;
  const effectiveKategori = patch.kategori || existing.kategori;

  if (patch.jenis || patch.kategori) {
    const kategoriMap = await getCategories();
    if (!kategoriValid(effectiveJenis, effectiveKategori, kategoriMap)) {
      return NextResponse.json({ error: "Kategori tidak sesuai dengan jenis transaksi." }, { status: 400 });
    }
  }
  if (patch.jumlah !== undefined) {
    const n = Number(patch.jumlah);
    if (!n || n <= 0) return NextResponse.json({ error: "Jumlah harus angka positif." }, { status: 400 });
    patch.jumlah = n;
  }

  try {
    const updated = await updateTransactionById(id, patch);
    if (!updated) return NextResponse.json({ error: "Transaksi tidak ditemukan." }, { status: 404 });
    if (updated.tanggal) await clearCachedAnalysis(monthKeyOf(updated.tanggal));
    if (existing.tanggal && monthKeyOf(existing.tanggal) !== monthKeyOf(updated.tanggal)) {
      await clearCachedAnalysis(monthKeyOf(existing.tanggal));
    }
    return NextResponse.json({ transaksi: updated });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(_req, { params }) {
  const resolvedParams = await params;
  const id = resolvedParams?.id;
  try {
    const deleted = await deleteTransactionById(id);
    if (!deleted) return NextResponse.json({ error: "Transaksi tidak ditemukan." }, { status: 404 });
    if (deleted.tanggal) await clearCachedAnalysis(monthKeyOf(deleted.tanggal));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
