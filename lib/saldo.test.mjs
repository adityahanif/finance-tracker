import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hitungRingkasanBulan,
  hitungSaldoPadaTanggal,
  hitungSaldoAwal,
} from "./saldo.js";

const tx = (tanggal, jenis, jumlah, kategori = "Lainnya") => ({
  tanggal,
  jenis,
  jumlah,
  kategori,
  deskripsi: kategori,
});

// Skenario utama dari permintaan:
// - Saldo akhir Oktober 2026 = Rp2.000.000
// - 1-4 November: pengeluaran total Rp2.000.000
// - 5 November: gaji masuk
// Harapan: saldo per 4 Nov = 0 (bukan minus), saldo awal Nov terbawa dari
// Oktober, dan total pemasukan November HANYA berisi gaji.
test("skenario Okt -> Nov: saldo awal terbawa, tgl 4 = 0, pemasukan Nov hanya gaji", () => {
  const transaksi = [
    // Oktober bersih +2.000.000
    tx("2026-10-05", "pemasukan", 5_000_000, "Gaji"),
    tx("2026-10-10", "pengeluaran", 3_000_000, "Belanja"),
    // November sebelum gajian: pengeluaran 2.000.000 (1-4 Nov)
    tx("2026-11-01", "pengeluaran", 800_000, "Belanja"),
    tx("2026-11-03", "pengeluaran", 700_000, "Tagihan & Utilitas"),
    tx("2026-11-04", "pengeluaran", 500_000, "Transportasi"),
    // Gaji 5 November
    tx("2026-11-05", "pemasukan", 5_000_000, "Gaji"),
  ];

  const okt = hitungRingkasanBulan(transaksi, {}, "2026-10");
  assert.equal(okt.saldo_awal, 0); // bulan pertama
  assert.equal(okt.saldo_akhir, 2_000_000);

  const nov = hitungRingkasanBulan(transaksi, {}, "2026-11");
  assert.equal(nov.saldo_awal, 2_000_000); // terbawa otomatis
  assert.equal(nov.saldo_awal_sumber, "otomatis");
  // Saldo awal TIDAK dihitung sebagai pemasukan:
  assert.equal(nov.total_pemasukan, 5_000_000); // hanya gaji
  assert.equal(nov.total_pengeluaran, 2_000_000);
  assert.equal(nov.saldo_akhir, 5_000_000); // 2jt + 5jt - 2jt

  // Per 4 November (sebelum gaji): 2jt - 2jt = 0, bukan minus
  assert.equal(hitungSaldoPadaTanggal(transaksi, {}, "2026-11-04"), 0);
  assert.equal(hitungSaldoPadaTanggal(transaksi, {}, "2026-11-05"), 5_000_000);
});

test("screenshot: pemasukan & pengeluaran saja tanpa riwayat sebelum = saldo lama", () => {
  const transaksi = [
    tx("2026-10-02", "pemasukan", 15_919_815, "Gaji"),
    tx("2026-10-03", "pengeluaran", 13_761_018, "Belanja"),
  ];
  const r = hitungRingkasanBulan(transaksi, {}, "2026-10");
  assert.equal(r.saldo_awal, 0);
  assert.equal(r.saldo_akhir, 2_158_797);
});

test("bulan pertama saldo awal 0", () => {
  const { saldoAwal, sumber } = hitungSaldoAwal([], {}, "2026-10");
  assert.equal(saldoAwal, 0);
  assert.equal(sumber, "otomatis");
});

test("bulan tanpa transaksi tetap meneruskan saldo", () => {
  const transaksi = [tx("2026-10-05", "pemasukan", 500_000, "Gaji")];
  const nov = hitungRingkasanBulan(transaksi, {}, "2026-11");
  assert.equal(nov.saldo_awal, 500_000);
  assert.equal(nov.total_pemasukan, 0);
  assert.equal(nov.total_pengeluaran, 0);
  assert.equal(nov.saldo_akhir, 500_000);
  // Bahkan bulan yang dilompati (Desember, tanpa data Nov) tetap terbawa
  const des = hitungRingkasanBulan(transaksi, {}, "2026-12");
  assert.equal(des.saldo_awal, 500_000);
  assert.equal(des.saldo_akhir, 500_000);
});

test("saldo akhir negatif terbawa apa adanya ke bulan berikut", () => {
  const transaksi = [tx("2026-10-05", "pengeluaran", 300_000, "Belanja")];
  const okt = hitungRingkasanBulan(transaksi, {}, "2026-10");
  assert.equal(okt.saldo_akhir, -300_000);
  const nov = hitungRingkasanBulan(transaksi, {}, "2026-11");
  assert.equal(nov.saldo_awal, -300_000);
  assert.equal(nov.saldo_akhir, -300_000);
});

test("override manual menjadi baseline baru dan tidak masuk pemasukan", () => {
  const transaksi = [
    tx("2026-10-05", "pemasukan", 5_000_000, "Gaji"),
    tx("2026-11-05", "pemasukan", 5_000_000, "Gaji"),
  ];
  const overrides = { "2026-11": 1_000_000 };

  const nov = hitungRingkasanBulan(transaksi, overrides, "2026-11");
  assert.equal(nov.saldo_awal, 1_000_000);
  assert.equal(nov.saldo_awal_sumber, "manual");
  assert.equal(nov.saldo_awal_otomatis, 5_000_000); // nilai otomatis tetap dilaporkan
  assert.equal(nov.total_pemasukan, 5_000_000); // override tidak menambah pemasukan
  assert.equal(nov.saldo_akhir, 6_000_000);

  // Bulan setelah override mengalir dari baseline manual:
  // 1jt (awal Nov) + 5jt (pemasukan Nov) = 6jt
  const des = hitungRingkasanBulan(transaksi, overrides, "2026-12");
  assert.equal(des.saldo_awal, 6_000_000);
});

test("override 0 dan nilai kosong: 0 dihormati, kosong dianggap otomatis", () => {
  const transaksi = [tx("2026-10-05", "pemasukan", 900_000, "Gaji")];
  const manualNol = hitungSaldoAwal(transaksi, { "2026-11": 0 }, "2026-11");
  assert.equal(manualNol.saldoAwal, 0);
  assert.equal(manualNol.sumber, "manual");

  const kosong = hitungSaldoAwal(transaksi, { "2026-11": "" }, "2026-11");
  assert.equal(kosong.saldoAwal, 900_000);
  assert.equal(kosong.sumber, "otomatis");
});

test("retroaktif: saldo awal = jumlah bersih semua bulan sebelumnya", () => {
  const transaksi = [
    tx("2026-08-05", "pemasukan", 1_000_000, "Gaji"),
    tx("2026-09-05", "pengeluaran", 250_000, "Belanja"),
    tx("2026-10-05", "pemasukan", 100_000, "Gaji"),
  ];
  const nov = hitungRingkasanBulan(transaksi, {}, "2026-11");
  assert.equal(nov.saldo_awal, 850_000);
});
