// Fallback statis (hanya dipakai kalau tab "Kategori" di Sheets kosong/gagal
// dibaca). Sumber kategori yang sebenarnya sekarang di Google Sheets — lihat
// getCategories() di lib/sheets.js.
export const KATEGORI_PENGELUARAN_FALLBACK = [
  "Makanan & Minuman",
  "Transportasi",
  "Belanja",
  "Tagihan & Utilitas",
  "Kesehatan",
  "Hiburan",
  "Pendidikan",
  "Nafkah Istri",
  "Sedekah/Giving",
  "Piutang",
  "Menabung/Saving",
  "Investasi",
  "Lainnya",
];

export const KATEGORI_PEMASUKAN_FALLBACK = [
  "Gaji",
  "Bonus/THR",
  "Investasi",
  "Utang",
  "Pemberian",
  "Bisnis",
  "Lainnya",
];

// kategoriMap: { pengeluaran: string[], pemasukan: string[] } — didapat dari getCategories()
export function kategoriValid(jenis, kategori, kategoriMap) {
  const daftar = kategoriMap?.[jenis] || [];
  return daftar.includes(kategori);
}
