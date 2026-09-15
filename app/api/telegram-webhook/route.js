import { NextResponse } from "next/server";
import { parseFreeText } from "../../../lib/gemini";
import {
  appendTransaction,
  updateTransactionById,
  deleteTransactionById,
  getAllTransactions,
  clearCachedAnalysis,
  monthKeyOf,
  getCategories,
  getSetting,
} from "../../../lib/sheets";
import { kategoriValid } from "../../../lib/categories";
import { randomUUID } from "crypto";

const TELEGRAM_API = (token) =>
  `https://api.telegram.org/bot${token}`;

async function sendMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN belum diisi di environment variable."
    );
  }

  const res = await fetch(
    `${TELEGRAM_API(token)}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    }
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      data?.description ||
        "Gagal mengirim pesan ke Telegram."
    );
  }
}

function rupiah(n) {
  return (
    "Rp" +
    Math.round(n || 0).toLocaleString("id-ID")
  );
}

// ---------------------------------------------------------------------------
// /ringkasan
// ---------------------------------------------------------------------------

async function handleRingkasan(chatId) {
  const bulan = new Date()
    .toISOString()
    .slice(0, 7);

  const semua = await getAllTransactions();

  const bulanIni = semua.filter(
    (t) => monthKeyOf(t.tanggal) === bulan
  );

  const masuk = bulanIni
    .filter((t) => t.jenis === "pemasukan")
    .reduce((s, t) => s + t.jumlah, 0);

  const keluar = bulanIni
    .filter((t) => t.jenis === "pengeluaran")
    .reduce((s, t) => s + t.jumlah, 0);

  await sendMessage(
    chatId,
    `Ringkasan bulan ini:\nPemasukan: ${rupiah(
      masuk
    )}\nPengeluaran: ${rupiah(
      keluar
    )}\nSaldo bersih: ${rupiah(masuk - keluar)}`
  );
}

// ---------------------------------------------------------------------------
// /hapus
// ---------------------------------------------------------------------------

async function handleHapus(chatId, id) {
  if (!id) {
    return sendMessage(
      chatId,
      "Format: /hapus [id]"
    );
  }

  const ok = await deleteTransactionById(id);

  await sendMessage(
    chatId,
    ok
      ? `Transaksi ${id} dihapus.`
      : `ID ${id} tidak ditemukan.`
  );
}

// ---------------------------------------------------------------------------
// /edit
//
// Format:
// /edit <id> jumlah=20000 kategori=Transportasi deskripsi=ojek
// ---------------------------------------------------------------------------

async function handleEdit(chatId, args) {
  const [id, ...pairs] = args;

  if (!id || pairs.length === 0) {
    return sendMessage(
      chatId,
      "Format: /edit [id] field=nilai (contoh: /edit ab12cd jumlah=20000 kategori=Transportasi)"
    );
  }

  const patch = {};

  for (const p of pairs) {
    const [k, ...rest] = p.split("=");

    if (!k || rest.length === 0) continue;

    patch[k.trim()] = rest.join("=").trim();
  }

  if (patch.jumlah !== undefined) {
    patch.jumlah = Number(patch.jumlah);

    if (
      !Number.isFinite(patch.jumlah) ||
      patch.jumlah <= 0
    ) {
      return sendMessage(
        chatId,
        "Jumlah harus berupa angka positif."
      );
    }
  }

  // Validasi jenis jika dikirim
  if (
    patch.jenis &&
    patch.jenis !== "pemasukan" &&
    patch.jenis !== "pengeluaran"
  ) {
    return sendMessage(
      chatId,
      "Jenis harus 'pemasukan' atau 'pengeluaran'."
    );
  }

  // Validasi kategori
  if (patch.jenis && patch.kategori) {
    const kategoriMap = await getCategories();

    if (
      !kategoriValid(
        patch.jenis,
        patch.kategori,
        kategoriMap
      )
    ) {
      return sendMessage(
        chatId,
        `Kategori "${patch.kategori}" tidak valid untuk jenis "${patch.jenis}".`
      );
    }
  }

  const updated = await updateTransactionById(
    id,
    patch
  );

  if (!updated) {
    return sendMessage(
      chatId,
      `ID ${id} tidak ditemukan.`
    );
  }

  // Perubahan data transaksi tidak boleh dianggap gagal
  // hanya karena cache analisis gagal dibersihkan.
  try {
    await clearCachedAnalysis(
      monthKeyOf(updated.tanggal)
    );
  } catch (err) {
    console.error(
      "Gagal clear cache analisis setelah edit:",
      err
    );
  }

  await sendMessage(
    chatId,
    `Transaksi ${id} diperbarui.`
  );
}

// ---------------------------------------------------------------------------
// Pesan bebas Telegram
// Contoh:
// "bakso 15rb"
// "tanggal 15 September beli bensin 50 ribu"
// ---------------------------------------------------------------------------

async function handlePesanBebas(chatId, teks) {
  try {
    // -----------------------------------------------------------------------
    // 1. Ambil kategori
    // -----------------------------------------------------------------------

    const kategoriMap = await getCategories();

    // -----------------------------------------------------------------------
    // 2. Ambil model Gemini
    // -----------------------------------------------------------------------

    const model = await getSetting(
      "gemini_parse_model",
      process.env.GEMINI_PARSE_MODEL ||
        "gemini-3.5-flash-lite"
    );

    // -----------------------------------------------------------------------
    // 3. Parsing menggunakan Gemini
    // -----------------------------------------------------------------------

    let hasil;

    try {
      hasil = await parseFreeText(
        teks,
        kategoriMap,
        model
      );
    } catch (err) {
      console.error(
        "Gemini parsing error:",
        err
      );

      return sendMessage(
        chatId,
        "Gagal memproses pesan, coba lagi sebentar lagi."
      );
    }

    // -----------------------------------------------------------------------
    // 4. Validasi hasil parsing
    // -----------------------------------------------------------------------

    if (
      hasil?.error ||
      !hasil?.transaksi ||
      hasil.transaksi.length === 0
    ) {
      return sendMessage(
        chatId,
        hasil?.error ||
          "Pesan kurang jelas. Sertakan jumlah dan keterangan transaksinya ya."
      );
    }

    // -----------------------------------------------------------------------
    // 5. Simpan transaksi satu per satu
    // -----------------------------------------------------------------------

    const ringkasanBaris = [];

    for (const t of hasil.transaksi) {
      const jenis =
        t.jenis === "pemasukan"
          ? "pemasukan"
          : "pengeluaran";

      const kategori = kategoriValid(
        jenis,
        t.kategori,
        kategoriMap
      )
        ? t.kategori
        : "Lainnya";

      const jumlah = Number(t.jumlah) || 0;

      if (jumlah <= 0) {
        console.warn(
          "Transaksi dengan jumlah tidak valid dilewati:",
          t
        );
        continue;
      }

      const tx = {
        id: randomUUID(),

        tanggal:
          t.tanggal ||
          new Date()
            .toISOString()
            .slice(0, 10),

        jenis,

        jumlah,

        kategori,

        deskripsi:
          t.deskripsi || teks,

        chat_asli: teks,

        sumber_input: "telegram",

        timestamp_input:
          new Date().toISOString(),
      };

      // ---------------------------------------------------------------------
      // 6. TULIS KE GOOGLE SHEETS
      // ---------------------------------------------------------------------
      // Ini adalah bagian terpenting.
      // Bila gagal, error akan dilempar dan ditangani oleh catch utama.

      try {
        await appendTransaction(tx);
      } catch (err) {
        console.error(
          "Gagal append transaksi ke Google Sheets:",
          err
        );

        return sendMessage(
          chatId,
          `Gagal menyimpan transaksi ke Google Sheets.\n\nDetail: ${
            err?.message ||
            "Terjadi kesalahan."
          }`
        );
      }

      // ---------------------------------------------------------------------
      // 7. Bersihkan cache analisis
      // ---------------------------------------------------------------------
      // Jika bagian ini gagal, transaksi SUDAH berhasil disimpan.
      // Jadi jangan menganggap transaksi gagal.

      try {
        await clearCachedAnalysis(
          monthKeyOf(tx.tanggal)
        );
      } catch (err) {
        console.error(
          "Gagal clear cache analisis:",
          err
        );
      }

      ringkasanBaris.push(
        `${
          jenis === "pemasukan"
            ? "+"
            : "-"
        }${rupiah(tx.jumlah)} — ${
          tx.kategori
        } (${tx.deskripsi}) [id:${tx.id.slice(
          0,
          6
        )}]`
      );
    }

    // -----------------------------------------------------------------------
    // 8. Pastikan ada transaksi yang benar-benar disimpan
    // -----------------------------------------------------------------------

    if (ringkasanBaris.length === 0) {
      return sendMessage(
        chatId,
        "Tidak ada transaksi yang berhasil disimpan. Pastikan jumlah transaksi valid."
      );
    }

    // -----------------------------------------------------------------------
    // 9. Balas ke Telegram
    // -----------------------------------------------------------------------

    await sendMessage(
      chatId,
      `Tercatat:\n${ringkasanBaris.join(
        "\n"
      )}`
    );
  } catch (err) {
    console.error(
      "Telegram transaction error:",
      err
    );

    await sendMessage(
      chatId,
      `Gagal memproses transaksi.\n\nDetail: ${
        err?.message ||
        "Terjadi kesalahan di server."
      }`
    );
  }
}

// ---------------------------------------------------------------------------
// Telegram Webhook
// ---------------------------------------------------------------------------

export async function POST(req) {
  // -------------------------------------------------------------------------
  // 1. Validasi secret Telegram
  // -------------------------------------------------------------------------

  const secretHeader = req.headers.get(
    "x-telegram-bot-api-secret-token"
  );

  if (
    secretHeader !==
    process.env.TELEGRAM_WEBHOOK_SECRET
  ) {
    return NextResponse.json(
      {
        error:
          "Token webhook tidak valid.",
      },
      { status: 401 }
    );
  }

  // -------------------------------------------------------------------------
  // 2. Ambil update dari Telegram
  // -------------------------------------------------------------------------

  const update = await req
    .json()
    .catch(() => ({}));

  const msg = update.message;

  if (!msg || !msg.text) {
    return NextResponse.json({
      ok: true,
    });
  }

  const chatId = msg.chat.id;
  const teks = msg.text.trim();

  // -------------------------------------------------------------------------
  // 3. Routing command
  // -------------------------------------------------------------------------

  try {
    if (teks.startsWith("/ringkasan")) {
      await handleRingkasan(chatId);
    } else if (teks.startsWith("/hapus")) {
      const [, id] = teks.split(/\s+/);

      await handleHapus(
        chatId,
        id
      );
    } else if (teks.startsWith("/edit")) {
      const [, ...args] =
        teks.split(/\s+/);

      await handleEdit(
        chatId,
        args
      );
    } else if (teks.startsWith("/start")) {
      await sendMessage(
        chatId,
        'Halo! Kirim pesan seperti "bakso 15rb" untuk mencatat transaksi. Perintah lain: /ringkasan, /edit [id] field=nilai, /hapus [id].'
      );
    } else {
      // Pesan biasa → AI parser → Google Sheets
      await handlePesanBebas(
        chatId,
        teks
      );
    }
  } catch (err) {
    console.error(
      "Telegram webhook error:",
      err
    );

    try {
      await sendMessage(
        chatId,
        `Terjadi kesalahan di server.\n\nDetail: ${
          err?.message ||
          "Terjadi kesalahan."
        }`
      );
    } catch (sendErr) {
      console.error(
        "Gagal mengirim pesan error ke Telegram:",
        sendErr
      );
    }
  }

  return NextResponse.json({
    ok: true,
  });
}
