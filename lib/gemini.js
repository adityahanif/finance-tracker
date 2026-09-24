const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pesanRamahGemini(status, errText) {
  if (status === 503 || /high demand|overloaded|UNAVAILABLE/i.test(errText || "")) {
    return "Model AI sedang sibuk (permintaan membludak sesaat). Coba lagi 1–2 menit.";
  }
  if (status === 429 || /quota|rate|RESOURCE_EXHAUSTED|limit/i.test(errText || "")) {
    if (/daily|per day|RPD|requests per day/i.test(errText || "")) {
      return "Batas pemakaian harian AI tercapai. Coba lagi besok.";
    }
    return "Batas pemakaian AI tercapai. Tunggu 1–5 menit lalu coba lagi.";
  }
  if (status === 404 || /not found|NOT_FOUND/i.test(errText || "")) {
    return "Nama model AI tidak ditemukan. Cek di menu Pengaturan (sesuaikan dengan daftar di Google AI Studio).";
  }
  if (status === 400 || /API key|API_KEY/i.test(errText || "")) {
    return "API key Gemini bermasalah. Cek GEMINI_API_KEY di environment variable.";
  }
  return null;
}

async function callGemini(model, prompt, { retries = 2, timeoutMs = 25000 } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY belum diisi di environment variable.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2 },
  });

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        const ramah = pesanRamahGemini(res.status, errText);
        lastErr = new Error(ramah || `Gemini API error (${res.status}): ${errText.slice(0, 300)}`);
        lastErr.status = res.status;
        lastErr.retryable = RETRYABLE_STATUS.has(res.status);
      } else {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
        return text.trim();
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        lastErr = new Error("Permintaan ke AI kehabisan waktu (timeout). Coba lagi.");
        lastErr.retryable = true;
      } else if (!err.status) {
        lastErr = err; // network error dari fetch
        lastErr.retryable = true;
      } else {
        lastErr = err;
      }
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries && lastErr?.retryable) {
      await sleep(1500 * (attempt + 1)); // backoff: 1.5s, 3s
      continue;
    }
    throw lastErr;
  }
}

function extractJson(raw) {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Respons model tidak mengandung JSON yang valid.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function todayStr() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

function formatRiwayat(riwayat) {
  if (!Array.isArray(riwayat) || riwayat.length === 0) return "";
  const examples = [];
  const seen = new Set();
  for (let i = riwayat.length - 1; i >= 0 && examples.length < 30; i--) {
    const item = riwayat[i];
    if (typeof item === "string") {
      examples.push(item);
    } else if (item && item.deskripsi && item.kategori) {
      const desk = item.deskripsi.trim().toLowerCase();
      if (!seen.has(desk)) {
        seen.add(desk);
        examples.push(`- "${item.deskripsi.trim()}" -> ${item.jenis || "pengeluaran"}: ${item.kategori}`);
      }
    }
  }
  if (examples.length === 0) return "";
  return `\nHistori preferensi kategori user sebelumnya (utamakan pola ini jika konteks/deskripsi serupa):\n${examples.join("\n")}\n`;
}

// FR-8 s/d FR-12: ekstrak transaksi dari teks bebas (dipakai bot Telegram & "Tambah Cepat" website)
// kategoriMap: { pengeluaran: string[], pemasukan: string[] } — dari getCategories()
// model: nama model Gemini (dari getSetting() atau env var), fallback ke default kalau kosong
// fallbackModel: model cadangan kalau primer 503/429 (mis. isi via GEMINI_PARSE_MODEL_FALLBACK)
// riwayat: array transaksi terakhir untuk few-shot learning preferensi kategori user
export async function parseFreeText(teks, kategoriMap, model, fallbackModel, riwayat = []) {
  const historiSection = formatRiwayat(riwayat);
  const prompt = `Kamu adalah parser transaksi keuangan pribadi untuk orang Indonesia.
Ekstrak SATU atau LEBIH transaksi dari pesan bebas berikut (urutan tanggal/jumlah/deskripsi bisa bebas).
Jumlah bisa ditulis informal ("15rb","5k","50.000","50000") — ubah semua ke angka murni tanpa titik/koma.
Jika tanggal tidak disebutkan eksplisit, gunakan tanggal hari ini: ${todayStr()} (format YYYY-MM-DD).
Kategori pengeluaran HARUS salah satu dari daftar ini: ${kategoriMap.pengeluaran.join(", ")}.
Kategori pemasukan HARUS salah satu dari daftar ini: ${kategoriMap.pemasukan.join(", ")}.${historiSection}
Jika pesan tidak mengandung informasi transaksi yang jelas (ambigu/bukan transaksi), jangan mengarang — kembalikan error.

Balas HANYA dengan JSON valid, tanpa teks lain, tanpa markdown code fence, persis bentuk ini:
{"transaksi":[{"tanggal":"YYYY-MM-DD","jenis":"pemasukan atau pengeluaran","jumlah":angka,"deskripsi":"string singkat","kategori":"string dari daftar"}],"error":null}
Jika gagal:
{"transaksi":[],"error":"kalimat singkat berbahasa Indonesia meminta klarifikasi ke user"}

Pesan user: "${teks}"`;

  const primer = model || process.env.GEMINI_PARSE_MODEL || "gemini-3.5-flash-lite";
  const cadangan = fallbackModel || process.env.GEMINI_PARSE_MODEL_FALLBACK || null;
  let raw;
  try {
    raw = await callGemini(primer, prompt);
  } catch (err) {
    if (cadangan && cadangan !== primer && err?.retryable) {
      raw = await callGemini(cadangan, prompt, { retries: 1 });
    } else {
      throw err;
    }
  }
  try {
    return extractJson(raw);
  } catch {
    return { transaksi: [], error: "Model tidak bisa memproses pesan ini, coba tulis ulang dengan format lebih jelas." };
  }
}

// FR-26 s/d FR-28: insight dari data teragregasi (bukan raw chat, hemat token)
export async function generateAnalysis(aggregate, model, customPrompt) {
  const baseContext = `Kamu adalah asisten analisis keuangan pribadi. Berikut data teragregasi (bukan transaksi mentah) bulan berjalan vs bulan sebelumnya, dalam Rupiah:
${JSON.stringify(aggregate, null, 2)}

Instruksi mutlak:
- Kamu HANYA boleh menganalisis data keuangan di atas. Jawab pertanyaan user SELALU dalam konteks data keuangan ini.
- Jangan pernah menjawab topik di luar keuangan (resep masak, cerita fiksi, dll). Arahkan kembali ke analisis keuangan.
- Tulis analisis sebagai teks biasa yang enak dibaca, jangan pakai format JSON.`;

  const prompt = customPrompt && customPrompt.trim()
    ? `${baseContext}\n${customPrompt.trim()}`
    : `${baseContext}\nTulis analisis singkat berbahasa Indonesia (maksimal 5-6 kalimat, boleh pakai poin "-"), mencakup:
1) kategori dengan kenaikan/penurunan signifikan dibanding bulan sebelumnya,
2) potensi anomali pengeluaran (nominal tidak wajar dibanding pola biasa),
3) satu saran umum yang praktis.`;

  return callGemini(model || process.env.GEMINI_ANALYSIS_MODEL || "gemini-3.8-flash", prompt);
}
