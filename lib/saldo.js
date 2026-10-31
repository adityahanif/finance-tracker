// Logika Saldo Awal / Saldo Akhir per bulan — fungsi murni, tanpa akses
// Google Sheets, supaya bisa ditest langsung (lib/saldo.test.mjs).
//
// Definisi:
// - Saldo Awal bulan M (otomatis) = saldo akhir bulan sebelumnya, dihitung
//   retroaktif dari transaksi pertama: jumlah bersih (pemasukan - pengeluaran)
//   semua transaksi sebelum M.
// - Override manual untuk bulan K (disimpan di tab Pengaturan dengan key
//   `saldo_awal_YYYY-MM`, lihat lib/sheets.js) menjadi baseline baru:
//   saldo awal bulan-bulan setelah K dihitung dari override K ditambah
//   jumlah bersih transaksi sejak bulan K.
// - Saldo Awal BUKAN transaksi: tidak pernah masuk total pemasukan,
//   statistik, grafik, maupun kategori pemasukan.
// - Saldo Akhir = Saldo Awal + Total Pemasukan - Total Pengeluaran.
//   Saldo negatif tetap terbawa apa adanya (tidak di-clamp ke 0).

export function isValidMonthKey(bulan) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(bulan || ""));
}

export function monthKeyOfTanggal(tanggal) {
  return (tanggal || "").slice(0, 7);
}

export function saldoAwalSettingKey(bulan) {
  return `saldo_awal_${bulan}`;
}

// Terima overrides dalam bentuk Map, plain object { "YYYY-MM": angka },
// atau array pasangan [bulan, angka]. Nilai kosong / bukan angka diabaikan
// (dianggap tidak ada override — penting untuk migrasi data lama di mana
// key di Pengaturan bisa saja kosong).
export function normalizeOverrides(overrides) {
  const map = new Map();
  if (!overrides) return map;

  const entries =
    overrides instanceof Map
      ? [...overrides.entries()]
      : Array.isArray(overrides)
        ? overrides
        : Object.entries(overrides);

  for (const [bulan, nilai] of entries) {
    const key = String(bulan || "").trim();
    if (!isValidMonthKey(key)) continue;
    if (nilai === null || nilai === undefined || String(nilai).trim() === "") continue;
    const num = Number(nilai);
    if (!Number.isFinite(num)) continue;
    map.set(key, num);
  }
  return map;
}

function netTransaksi(t) {
  const jumlah = Number(t?.jumlah) || 0;
  if (t?.jenis === "pemasukan") return jumlah;
  if (t?.jenis === "pengeluaran") return -jumlah;
  return 0;
}

// Saldo awal yang akan dipakai user SEANDAINYA tidak ada override manual
// untuk bulan itu sendiri. Override manual bulan-bulan SEBELUMNYA tetap
// dihormati sebagai baseline.
export function hitungSaldoAwalOtomatis(transaksi, overrides, bulan) {
  const map = normalizeOverrides(overrides);

  // Baseline: override manual terakhir yang bulannya < bulan target.
  let baselineBulan = null;
  let baselineNilai = 0;
  for (const [k, v] of map.entries()) {
    if (k < bulan && (baselineBulan === null || k > baselineBulan)) {
      baselineBulan = k;
      baselineNilai = v;
    }
  }

  let bersih = 0;
  for (const t of transaksi || []) {
    const mk = monthKeyOfTanggal(t?.tanggal);
    if (!isValidMonthKey(mk)) continue;
    if (mk >= bulan) continue;
    if (baselineBulan !== null && mk < baselineBulan) continue;
    bersih += netTransaksi(t);
  }

  // Bulan pertama (tidak ada transaksi & tidak ada baseline sebelumnya)
  // otomatis menghasilkan 0 di sini.
  return (baselineBulan !== null ? baselineNilai : 0) + bersih;
}

export function hitungSaldoAwal(transaksi, overrides, bulan) {
  const map = normalizeOverrides(overrides);
  const otomatis = hitungSaldoAwalOtomatis(transaksi, map, bulan);
  if (map.has(bulan)) {
    return { saldoAwal: map.get(bulan), saldoAwalOtomatis: otomatis, sumber: "manual" };
  }
  return { saldoAwal: otomatis, saldoAwalOtomatis: otomatis, sumber: "otomatis" };
}

// Ringkasan satu bulan. Total pemasukan/pengeluaran murni dari transaksi
// bulan itu — saldo awal sengaja TIDAK ditambahkan ke total pemasukan.
export function hitungRingkasanBulan(transaksi, overrides, bulan) {
  let totalPemasukan = 0;
  let totalPengeluaran = 0;
  for (const t of transaksi || []) {
    if (monthKeyOfTanggal(t?.tanggal) !== bulan) continue;
    const jumlah = Number(t?.jumlah) || 0;
    if (t?.jenis === "pemasukan") totalPemasukan += jumlah;
    else if (t?.jenis === "pengeluaran") totalPengeluaran += jumlah;
  }

  const { saldoAwal, saldoAwalOtomatis, sumber } = hitungSaldoAwal(transaksi, overrides, bulan);

  return {
    bulan,
    saldo_awal: saldoAwal,
    saldo_awal_otomatis: saldoAwalOtomatis,
    saldo_awal_sumber: sumber,
    total_pemasukan: totalPemasukan,
    total_pengeluaran: totalPengeluaran,
    saldo_akhir: saldoAwal + totalPemasukan - totalPengeluaran,
  };
}

// Saldo berjalan pada satu tanggal (YYYY-MM-DD): saldo awal bulan tanggal
// itu + jumlah bersih transaksi bulan itu sampai tanggal tersebut.
// Dipakai test skenario "pengeluaran sebelum gajian".
export function hitungSaldoPadaTanggal(transaksi, overrides, tanggal) {
  const bulan = monthKeyOfTanggal(tanggal);
  const { saldoAwal } = hitungSaldoAwal(transaksi, overrides, bulan);
  let bersih = 0;
  for (const t of transaksi || []) {
    if (monthKeyOfTanggal(t?.tanggal) !== bulan) continue;
    if ((t?.tanggal || "") > tanggal) continue;
    bersih += netTransaksi(t);
  }
  return saldoAwal + bersih;
}
