# Design — Buku Kas / Personal Finance Tracker

> Dokumen desain teknis untuk project ini. Stack: Next.js App Router (single project Vercel) + Telegram Bot + Google Sheets (database) + Gemini AI (parsing & analisis).

## 1. Ringkasan & Tujuan

**Masalah:** pencatatan keuangan harian sering gagal karena friction — buka app, isi form, pilih kategori.

**Solusi:**
- Input paling cepat lewat **chat Telegram bahasa natural** (`"bakso 15rb sama es teh 5rb"` → N transaksi), plus form web sebagai cadangan.
- **Dashboard web** untuk ringkasan, tabel, grafik, analisis AI, dan pengaturan.
- **Tanpa database/server sendiri** — Google Sheets sebagai storage agar mudah dilihat/diedit manual dan tanpa biaya infra tambahan.

**Non-goals (disepakati, jangan ditambah tanpa revisi PRD):**
- Single-user (satu pemilik, bukan multi-tenant).
- Tidak ada koneksi bank otomatis / Open Banking.
- Tidak ada budgeting, alert, atau reminder.
- Asumsi mata uang tunggal: Rupiah (IDR).

## 2. Tech Stack

| Lapisan | Pilihan | Alasan |
|---|---|---|
| Framework | Next.js 16 (App Router), React 18 | Satu deploy untuk web + API + webhook Telegram |
| Hosting | Vercel | Serverless, webhook-friendly |
| Database | Google Sheets API v4 (`googleapis`) via Service Account | Gratis, transparan, bisa diedit manual |
| AI | Gemini `generateContent` REST (`lib/gemini.js`) | Parsing teks bebas + analisis agregat; model bisa diganti tanpa deploy |
| Auth web | PIN + JWT (`jose`, HS256) di cookie httpOnly | Simpel untuk single-user, sesi 30 menit |
| PIN storage | `scrypt` + salt di tab `Pengaturan` (`pin_hash`), fallback `PIN_CODE` env | Bisa ganti PIN dari dashboard |
| Chart | `recharts` (Pie + ComposedChart Bar) | Cukup untuk pie kategori + tren 6 bulan |
| Markdown | `react-markdown` | Render output analisis AI |
| Styling | CSS murni (`app/globals.css`, CSS variables) | Tema ledger/kertas: `--green #2F5233`, `--brick #A13D2C`, `--blue #2C4A6E` |

## 3. Arsitektur Sistem

```
                ┌──────────────┐
                │  Telegram    │
                │  User (privat)│
                └──────┬───────┘
                       │ pesan / command
                       ▼
┌────────┐   ┌─────────────────────────┐   ┌──────────────┐   ┌─────────┐
│ Browser│──▶│ Next.js (Vercel)        │──▶│ Google Sheets│──▶│ Gemini  │
│ Dashboard│ │ app/api/* + middleware  │◀──│ (4 tab)      │   │ API     │
└────────┘   └─────────────────────────┘   └──────────────┘   └─────────┘
```

### 3.1 Struktur direktori (aktual)

```
app/
  page.js                      → redirect ke /dashboard
  layout.js + globals.css      → shell + tema
  login/page.js                → layar PIN
  dashboard/
    page.js                    → server wrapper, render DashboardClient
    DashboardClient.js         → seluruh UI (Ringkasan/Transaksi/Tambah/Analisis/Pengaturan)
  api/
    auth/route.js              → POST verifikasi PIN → set cookie sesi
    telegram-webhook/route.js  → POST dari Telegram (secret header), parsing, balas
    transactions/route.js      → GET list (?bulan=YYYY-MM), POST form terstruktur
    transactions/[id]/route.js → PATCH edit, DELETE hapus
    quick-add/route.js         → POST teks bebas web → AI → simpan
    analysis/route.js          → GET cache, POST generate ulang
    categories/route.js        → GET kategori dari Sheets
    settings/route.js          → GET/POST nama model Gemini
    settings/pin/route.js      → POST ganti PIN
lib/
  sheets.js     → semua I/O Sheets + cache in-memory (transaksi/kategori/settings)
  gemini.js     → callGemini(), parseFreeText(), generateAnalysis()
  auth.js       → create/verify JWT, checkPin(), changePin(), scrypt hashing
  categories.js → fallback statis + kategoriValid()
  constants.js  → SESSION_COOKIE = "fintrack_session"
middleware.js   → guard /dashboard + API privat (kecuali webhook & auth)
scripts/set-webhook.js → daftarkan webhook Telegram ke URL Vercel
```

### 3.2 Alur data utama

1. **Catat (Telegram / Tambah Cepat):**
   `teks bebas → getCategories() + getSetting(model) → parseFreeText() → validasi jumlah>0 + kategori fallback "Lainnya" → appendTransaction() × N → clearCachedAnalysis(bulan) → balas ringkasan + id pendek`
2. **Catat (Form):** `validasi sync di API (tanpa AI) → append → invalidasi cache analisis`
3. **Baca:** `GET /api/transactions` (cache Sheets 10 dtk) → agregasi di client (Ringkasan) atau filter server (`?bulan=`)
4. **Analisis:** `GET cache dulu → kalau kosong/user klik "Jalankan" → buildAggregate(bulan vs prev) → generateAnalysis() → setCachedAnalysis()`
5. **Edit/Hapus:** `cari row by ID/prefix → update/delete → invalidasi cache bulan lama + baru`

## 4. Data Model (Google Sheets)

Satu spreadsheet, 4 tab. Header baris 1 wajib persis.

### 4.1 `Transaksi` — `A:I`
`id | tanggal | jenis | jumlah | kategori | deskripsi | chat_asli | sumber_input | timestamp_input`

| Kolom | Tipe / Aturan |
|---|---|
| `id` | UUID (`randomUUID()`); di bot ditampilkan 8 char pertama sebagai prefix untuk `/edit`/`/hapus` |
| `tanggal` | `YYYY-MM-DD` (zona Asia/Jakarta untuk default "hari ini") |
| `jenis` | `pemasukan` \| `pengeluaran` |
| `jumlah` | Number, integer Rupiah, harus `> 0` |
| `kategori` | String, harus ada di tab `Kategori` (jika tidak valid → fallback `"Lainnya"` di jalur AI, reject 400 di jalur form) |
| `deskripsi` | String singkat |
| `chat_asli` | Teks mentah user (kosong untuk form terstruktur) |
| `sumber_input` | `telegram` \| `website_quick_add` \| `website_form` |
| `timestamp_input` | ISO string |

### 4.2 `Kategori` — `A:B`
`jenis | kategori`, contoh baris: `pengeluaran, Makanan & Minuman`. Kategori **dinamis** — tambah/ubah di Sheets tanpa deploy. Kalau kosong/gagal baca → fallback `lib/categories.js`.

### 4.3 `Pengaturan` — `A:B`
`key | value`. Key yang dipakai:
- `gemini_parse_model` (cth. `gemini-3.5-flash-lite`)
- `gemini_analysis_model` (cth. `gemini-3.8-flash`)
- `pin_hash` (`salt:hash` scrypt, ditulis saat ganti PIN)

### 4.4 `AnalisisCache` — `A:C`
`bulan | teks | updated_at`, satu baris per `YYYY-MM`. Di-invalidasi (baris dihapus) setiap ada tambah/edit/hapus di bulan itu.

## 5. API Design

Semua response JSON. Error: `{ error: "pesan Bahasa Indonesia" }`.

| Method & Path | Auth | Input | Output | Keterangan |
|---|---|---|---|---|
| `POST /api/auth` | tidak | `{ pin }` | `200 { ok:true }` + set cookie | Gagal → 401 pesan generik (tanpa sisa percobaan) |
| `POST /api/telegram-webhook` | `x-telegram-bot-api-secret-token` == `TELEGRAM_WEBHOOK_SECRET` | Update Telegram | `{ ok:true }` | Selalu 200 ke Telegram kecuali secret salah (401); error bisnis dibalas sebagai chat |
| `GET /api/transactions?bulan=YYYY-MM` | PIN | query opsional | `{ transaksi: [] }` desc by tanggal | `middleware.js:37-44` |
| `POST /api/transactions` | PIN | `{ tanggal, jenis, jumlah, kategori, deskripsi }` | `201 { transaksi }` | Validasi FR-20; tanpa AI |
| `PATCH /api/transactions/[id]` | PIN | partial `{ tanggal, jenis, jumlah, kategori, deskripsi }` | `{ transaksi }` | Invalidasi cache bulan lama+baru |
| `DELETE /api/transactions/[id]` | PIN | — | `{ ok:true }` | Hapus baris via `deleteDimension` |
| `POST /api/quick-add` | PIN | `{ text }` | `201 { transaksi: [] }` | Ambigu → 422 + pesan klarifikasi; `jumlah<=0` → 422 |
| `GET /api/analysis?bulan=YYYY-MM` | PIN | query | `{ teks: string\|null, updated_at }` | Baca cache saja, tidak generate |
| `POST /api/analysis` | PIN | `{ bulan }` | `{ teks }` | Generate dari agregat + simpan cache |
| `GET /api/categories` | PIN | — | `{ pengeluaran: [], pemasukan: [] }` | Dari Sheets + fallback |
| `GET /api/settings` | PIN | — | `{ gemini_parse_model, gemini_analysis_model }` | Dari Sheets/env |
| `POST /api/settings` | PIN | `{ gemini_parse_model?, gemini_analysis_model? }` | `{ ok:true }` | Ganti model tanpa deploy |
| `POST /api/settings/pin` | PIN | `{ pinLama, pinBaru }` | `{ ok:true }` | Validasi: cocok lama + format baru |

### Command Telegram (`app/api/telegram-webhook/route.js`)
- Teks bebas → `handlePesanBebas()` (multi-transaksi per pesan didukung).
- `/ringkasan` → total bulan berjalan menurut zona Asia/Jakarta (sama seperti default tanggal di parsing AI).
- `/hapus [prefixId]` → `findIdByPrefix()`; tolak jika 0 atau >1 cocok.
- `/edit [prefixId] field=nilai` → parser `parseEditCommand()` dukung quoted value (`kategori="Makanan & Minuman"`); validasi `jumlah>0` + `kategoriValid()`.
- `/start` → pesan bantuan.
- Non-authorized username (`TELEGRAM_ALLOWED_USERNAMES`) → ditolak dengan balasan privat; jika env kosong → terbuka untuk semua (fail-open, lihat §8).

## 6. Auth & Security

- **Web:** `middleware.js` cek JWT di cookie `fintrack_session` untuk `/dashboard/*` dan API privat. API gagal → 401 JSON; page gagal → redirect `/login`.
- **Sesi:** `SignJWT({ok:true}, HS256)`, expiry `${SESSION_TTL_MINUTES||30}m`, cookie httpOnly (`lib/auth.js:17-23`, `app/api/auth/route.js`).
- **PIN:** `checkPin()` → `pin_hash` (scrypt+salt, `timingSafeEqual`) atau fallback `PIN_CODE`. `changePin()` tulis hash baru ke Sheets.
- **Webhook:** secret header `x-telegram-bot-api-secret-token`; token bot tidak pernah ke client.
- **Sheets:** Service Account (`GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY` dengan `\\n` → newline), scope `spreadsheets`, sheet di-share sebagai Editor.
- **Tidak ada rate-limit / brute-force counter** saat ini — pesan gagal generik saja (risiko dicatat di §8).

## 7. AI Integration (`lib/gemini.js`)

- Transport: `fetch` ke `.../v1beta/models/{model}:generateContent?key=...`, `temperature: 0.2`.
- **`parseFreeText(teks, kategoriMap, model)`** — prompt ID: parsing jumlah informal (`15rb/5k/50.000` → angka murni), default tanggal hari ini (Asia/Jakarta), kategori dibatasi ke daftar dinamis, output **hanya JSON** `{ transaksi[], error }`. `extractJson()` toleran terhadap code fence. Gagal parse → error klarifikasi ramah.
- **`generateAnalysis(aggregate, model)`** — input **agregat** (bukan raw transaksi, hemat token): per-kategori bulan berjalan vs sebelumnya + total. Output teks bebas 5–6 kalimat: delta signifikan, anomali, 1 saran praktis.
- **Model configurable:** `getSetting("gemini_parse_model" / "gemini_analysis_model", env fallback)` → ganti dari tab Pengaturan dashboard.

## 8. Frontend Design (`DashboardClient.js` + `globals.css`)

Tab tunggal dengan sidebar: **Ringkasan | Transaksi | Tambah | Analisis AI | Pengaturan**.

- **Ringkasan:** `MonthNav` (‹ ›, next disabled untuk bulan kini/masa depan), 3 `StatCard` (Pemasukan/blue, Pengeluaran/brick, Saldo/green), Donut `Pie` pengeluaran/kategori (inner 48/outer 78) + `PieLegend` (% 2 desimal), `ComposedChart` tren 6 bulan (Bar hijau/merah; Y-axis `jt` untuk jutaan). Agregasi client-side dari `GET /api/transactions` penuh.
- **Transaksi:** filter `input[type=month]` + dropdown kategori, sort desc tanggal, inline edit row (ganti jenis → reset kategori ke opsi pertama), hapus dengan `confirm()`, label sumber (`Telegram/Tambah cepat/Form`), pill jenis + nominal `+Rp/-Rp` berwarna.
- **Tambah:** dua panel — *Tambah cepat* (textarea + AI) dan *Form terstruktur* (jenis/tanggal/jumlah/kategori/deskripsi, tanpa AI).
- **Analisis AI:** GET cache per `curMonth`; tombol "Jalankan/Buat ulang"; render `ReactMarkdown`.
- **Pengaturan:** form ganti PIN (validasi konfirmasi cocok di client) + form nama model Gemini.
- **Tema:** putih kertas, font Arial/Helvetica, border tipis, sidebar 220px (collapse ke topbar di ≤760px), palet 13 warna pie, format `Rp + id-ID locale`.

**Catatan desain / tech debt yang diketahui:**
1. ~~`/ringkasan` bot pakai bulan UTC~~ — sudah diperbaiki: `handleRingkasan()` kini pakai `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" })`, konsisten dengan parsing AI & quick-add.
2. `TELEGRAM_ALLOWED_USERNAMES` kosong = bot terbuka publik (fail-open). Pertimbangkan fail-closed setelah username diset sekali.
3. Belum ada rate-limit PIN & paginasi tabel (client load seluruh transaksi untuk Ringkasan — wajar untuk skala personal, tapi perlu virtualisasi jika >ribuan baris).
4. Analisis hanya total + per-kategori; belum ada deteksi anomali statistik.

## 9. Caching & Konsistensi

| Cache | Lokasi | TTL | Invalidasi |
|---|---|---|---|
| Transaksi | `lib/sheets.js` in-memory (`_transactionsCache`) + request coalescing (`_transactionsCachePromise`) | 10 dtk | `append/update/delete` → `clearTransactionsCache()` |
| Kategori | in-memory | 60 dtk | TTL saja (perubahan Sheets terlihat ≤1 mnt) |
| Settings | in-memory | 60 dtk | `setSetting()` reset langsung |
| Analisis | Sheet `AnalisisCache` (persisten) | sampai data bulan berubah / generate ulang | `clearCachedAnalysis(bulan)` di semua jalur tulis |

ID lookup: `findRowNumberById()` baca kolom A lalu `update`/`deleteDimension` by nomor baris; `findIdByPrefix()` untuk UX bot (prefix unik 8 char).

## 10. Error Handling

- API: `try/catch → { error }` dengan status tepat (400 validasi, 401 auth, 422 ambigu AI, 500 server/Gemini/Sheets).
- Bot: tidak pernah melempar ke Telegram — semua kegagalan jadi balasan chat ramah; `console.error` di server untuk debug.
- Gemini gagal/JSON rusak → minta klarifikasi, **jangan simpan** (`hasil.error` / array kosong / `jumlah<=0` ditolak).
- Sheets gagal/kosong untuk kategori → fallback statis agar UI tidak error.

## 11. Deployment & Operasi

1. Buat spreadsheet + 4 tab sesuai §4, share Editor ke Service Account.
2. `@BotFather` → token; tentukan `TELEGRAM_WEBHOOK_SECRET`; AI Studio → `GEMINI_API_KEY`.
3. `.env.local` (lihat env di bawah) → `npm install && npm run dev` → login PIN di `/login`.
4. `vercel` deploy → `npm run set-webhook -- https://<domain>` (`scripts/set-webhook.js` set `url` + `secret_token` + `allowed_updates: ["message"]`).

**Env vars:** `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_USERNAMES` (opsional, koma), `GEMINI_API_KEY`, `GEMINI_PARSE_MODEL`, `GEMINI_ANALYSIS_MODEL`, `PIN_CODE`, `SESSION_SECRET`, `SESSION_TTL_MINUTES` (default 30).

## 12. Pengembangan Lanjutan (tidak mendesak)

- Samakan zona waktu ke Asia/Jakarta di semua jalur + uji batas bulan.
- Fail-closed Telegram auth + rate-limit PIN/webhook.
- Paginasi server-side / virtual list untuk tabel besar.
- Test: unit `parseEditCommand`, `extractJson`, `buildAggregate`; e2e webhook → Sheets mock.
- Opsional: budget per kategori, export CSV, PWA instalasi cepat.
