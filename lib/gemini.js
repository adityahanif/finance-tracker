async function callGemini(model, prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY belum diisi di environment variable.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errText}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  return text.trim();
}

function extractJson(raw) {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Respons model tidak mengandung JSON yang valid.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// FR-8 s/d FR-12: ekstrak transaksi dari teks bebas (dipakai bot Telegram & "Tambah Cepat" website)
// kategoriMap: { pengeluaran: string[], pemasukan: string[] } — dari getCategories()
// model: nama model Gemini (dari getSetting() atau env var), fallback ke default kalau kosong
export async function parseFreeText(teks, kategoriMap, model) {
  const prompt = `Kamu adalah parser transaksi keuangan pribadi untuk orang Indonesia.
Ekstrak SATU atau LEBIH transaksi dari pesan bebas berikut (urutan tanggal/jumlah/deskripsi bisa bebas).
Jumlah bisa ditulis informal ("15rb","5k","50.000","50000") — ubah semua ke angka murni tanpa titik/koma.
Jika tanggal tidak disebutkan eksplisit, gunakan tanggal hari ini: ${todayStr()} (format YYYY-MM-DD).
Kategori pengeluaran HARUS salah satu dari daftar ini: ${kategoriMap.pengeluaran.join(", ")}.
Kategori pemasukan HARUS salah satu dari daftar ini: ${kategoriMap.pemasukan.join(", ")}.
Jika pesan tidak mengandung informasi transaksi yang jelas (ambigu/bukan transaksi), jangan mengarang — kembalikan error.

Balas HANYA dengan JSON valid, tanpa teks lain, tanpa markdown code fence, persis bentuk ini:
{"transaksi":[{"tanggal":"YYYY-MM-DD","jenis":"pemasukan atau pengeluaran","jumlah":angka,"deskripsi":"string singkat","kategori":"string dari daftar"}],"error":null}
Jika gagal:
{"transaksi":[],"error":"kalimat singkat berbahasa Indonesia meminta klarifikasi ke user"}

Pesan user: "${teks}"`;

  const raw = await callGemini(model || process.env.GEMINI_PARSE_MODEL || "gemini-3.5-flash-lite", prompt);
  try {
    return extractJson(raw);
  } catch {
    return { transaksi: [], error: "Model tidak bisa memproses pesan ini, coba tulis ulang dengan format lebih jelas." };
  }
}

// FR-26 s/d FR-28: insight dari data teragregasi (bukan raw chat, hemat token)
export async function generateAnalysis(aggregate, model) {
  const prompt = `Kamu adalah asisten analisis keuangan pribadi. Berikut data teragregasi (bukan transaksi mentah) bulan berjalan vs bulan sebelumnya, dalam Rupiah:

${JSON.stringify(aggregate, null, 2)}

Tulis analisis singkat berbahasa Indonesia (maksimal 5-6 kalimat, boleh pakai poin "-"), mencakup:
1) kategori dengan kenaikan/penurunan signifikan dibanding bulan sebelumnya,
2) potensi anomali pengeluaran (nominal tidak wajar dibanding pola biasa),
3) satu saran umum yang praktis.
Tulis sebagai teks biasa yang enak dibaca, jangan pakai format JSON.`;

  return callGemini(model || process.env.GEMINI_ANALYSIS_MODEL || "gemini-3.8-flash", prompt);
}
