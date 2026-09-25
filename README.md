# Buku Kas — Personal Finance Tracker via Telegram Bot + AI

Implementasi PRD "Personal Finance Tracker via Telegram Bot + AI" (v1.1).
Next.js (App Router) di-deploy sebagai satu project Vercel, data disimpan di
Google Sheets, parsing & analisis pakai Gemini.

## Fitur yang sudah diimplementasikan

- Bot Telegram: catat transaksi dari teks bebas (multi-transaksi per pesan),
  `/ringkasan`, `/edit [id] field=nilai`, `/hapus [id]`, klarifikasi kalau
  pesan ambigu.
- Dashboard web dengan proteksi PIN (session 30 menit, cookie httpOnly).
- Form input terstruktur (tanpa panggilan AI) + "Tambah Cepat" teks bebas
  (dengan AI, endpoint sama dengan bot).
- Tabel transaksi dengan **filter bulan/kategori, pencarian (deskripsi/kategori/jumlah), sort, pagination**, edit & hapus.
- Ringkasan bulan berjalan, grafik pie per kategori, grafik tren 6 bulan
  (bar + trendline halus, hijau = pemasukan, merah = pengeluaran).
- Analisis AI dengan cache (disimpan di sheet `AnalisisCache`, tidak
  digenerate ulang kecuali diminta atau data bulan itu berubah). **Prompt analisis bisa dikustomisasi dari dashboard** (field opsional di tab Analisis AI).
- **Kategori dinamis** — dikelola lewat tab `Kategori` di spreadsheet, tidak
  hardcode di kode. Menambah/mengubah kategori tidak perlu deploy ulang.
- **Model Gemini bisa diganti dari dashboard** (tab "Pengaturan") tanpa
  ubah kode atau deploy ulang — disimpan di tab `Pengaturan` di spreadsheet.
- **Few-shot learning dari histori transaksi** — AI belajar preferensi kategori user dari edit sebelumnya (mis. "parkir" → "Lainnya" bukan "Transportasi") tanpa konfigurasi manual.
- **Pesan error AI lebih informatif** — bedakan rate-limit per menit (RPM/TPM) vs harian (RPD).

## 1. Siapkan Google Sheets

Buat spreadsheet baru, salin **Sheet ID** dari URL-nya, lalu buat 4 tab
dengan nama persis dan header baris pertama seperti ini:

| Tab | Header (baris 1) |
|---|---|
| `Transaksi` | `id \| tanggal \| jenis \| jumlah \| kategori \| deskripsi \| chat_asli \| sumber_input \| timestamp_input` |
| `AnalisisCache` | `bulan \| teks \| updated_at` |
| `Kategori` | `jenis \| kategori` (isi baris di bawahnya, contoh: `pengeluaran, Makanan & Minuman`) |
| `Pengaturan` | `key \| value` (isi 2 baris: `gemini_parse_model, gemini-3.5-flash-lite` dan `gemini_analysis_model, gemini-3.8-flash`) |

Di [Google Cloud Console](https://console.cloud.google.com/), aktifkan
**Google Sheets API** untuk project yang dipakai, buat **Service Account**,
generate JSON key, lalu **Share** spreadsheet ke email service account
(`...@...iam.gserviceaccount.com`) sebagai **Editor**.

## 2. Siapkan Telegram Bot

Chat [@BotFather](https://t.me/BotFather), `/newbot`, catat tokennya.
Tentukan sendiri `TELEGRAM_WEBHOOK_SECRET` (string acak bebas).

## 3. Siapkan Gemini API

Ambil API key dari [Google AI Studio](https://aistudio.google.com/). Nama
model default ada di `.env.example`, tapi bisa diganti kapan saja lewat tab
"Pengaturan" di dashboard tanpa deploy ulang.

## 4. Environment variables

Salin `.env.example` → `.env.local`, isi semua variabel. Untuk production,
isi variabel yang sama di **Vercel → Settings → Environment Variables**.

## 5. Jalankan lokal

```bash
npm install
npm run dev
```

Buka `http://localhost:3000` → diarahkan ke `/login` (masukkan PIN dari
`PIN_CODE`).

## 6. Deploy ke Vercel

```bash
npm i -g vercel
vercel
```

## 7. Daftarkan webhook Telegram

```bash
npm run set-webhook -- https://domain-kamu.vercel.app
```

## Struktur proyek

```
app/
  page.js                     → redirect ke /dashboard
  login/page.js                → layar PIN
  dashboard/
    page.js, DashboardClient.js → UI (tab: Ringkasan/Transaksi/Tambah/Analisis/Pengaturan)
  api/
    auth/route.js               → verifikasi PIN, buat sesi
    telegram-webhook/route.js   → terima pesan bot, parsing, balasan
    transactions/route.js       → GET list, POST tambah (form terstruktur)
    transactions/[id]/route.js  → PATCH edit, DELETE hapus
    quick-add/route.js          → POST teks bebas dari website (via AI)
    analysis/route.js           → GET cache, POST generate ulang analisis
    categories/route.js         → GET daftar kategori (dari tab Kategori)
    settings/route.js           → GET/POST nama model Gemini (dari tab Pengaturan)
lib/
  sheets.js      → semua akses baca/tulis Google Sheets (transaksi, kategori,
                    pengaturan, cache analisis)
  gemini.js      → pemanggilan model Gemini (parsing & analisis), model &
                    kategori dikirim sebagai parameter, bukan hardcode
  auth.js        → sesi JWT untuk PIN
  categories.js  → hanya fallback statis + fungsi validasi kategoriValid()
middleware.js    → proteksi PIN untuk /dashboard & semua API terkait (Next 16: lihat proxy.js)
```

## Catatan

- Non-goals PRD tetap dipegang: single-user, tidak ada koneksi bank otomatis,
  tidak ada budgeting/alert, asumsi Rupiah saja.
- `/edit` di bot memakai format sederhana `field=nilai` (mis.
  `/edit ab12cd jumlah=20000 kategori=Transportasi`).
- Kalau tab `Kategori` di spreadsheet kosong/belum dibuat, aplikasi otomatis
  fallback ke daftar kategori bawaan di `lib/categories.js` supaya tidak
  error — tapi disarankan tetap isi tabnya supaya bisa dikelola dari Sheets.
