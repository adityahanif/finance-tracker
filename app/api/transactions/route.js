import { NextResponse } from "next/server";
import { getAllTransactions, appendTransaction, clearCachedAnalysis, monthKeyOf, getCategories } from "../../../lib/sheets";
import { kategoriValid } from "../../../lib/categories";
import { randomUUID } from "crypto";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const bulan = searchParams.get("bulan"); // format YYYY-MM, opsional (single)
  const monthsParam = searchParams.get("months"); // format "YYYY-MM,YYYY-MM,...", opsional
  const from = searchParams.get("from"); // format YYYY-MM, opsional (inklusif)
  const to = searchParams.get("to"); // format YYYY-MM, opsional (inklusif)
  const kategori = searchParams.get("kategori");
  const search = (searchParams.get("search") || searchParams.get("q"))?.trim().toLowerCase();
  const page = parseInt(searchParams.get("page")) || 1;
  const limit = parseInt(searchParams.get("limit")) || 20;
  const sortBy = searchParams.get("sortBy") || "tanggalDesc";

  try {
    let data = await getAllTransactions();
    if (monthsParam) {
      const set = new Set(
        monthsParam.split(",").map((s) => s.trim()).filter(Boolean)
      );
      data = data.filter((t) => set.has(monthKeyOf(t.tanggal)));
    } else if (from || to) {
      data = data.filter((t) => {
        const mk = monthKeyOf(t.tanggal);
        if (from && mk < from) return false;
        if (to && mk > to) return false;
        return true;
      });
    } else if (bulan) {
      data = data.filter((t) => monthKeyOf(t.tanggal) === bulan);
    }

    // filter kategori jika disediakan
    if (kategori) {
      data = data.filter((t) => t.kategori === kategori);
    }

    if (search) {
      data = data.filter((t) =>
        (t.deskripsi && t.deskripsi.toLowerCase().includes(search)) ||
        (t.kategori && t.kategori.toLowerCase().includes(search)) ||
        String(t.jumlah).includes(search)
      );
    }

    // sorting
    data.sort((a, b) => {
      if (sortBy === "tanggalDesc") return a.tanggal < b.tanggal ? 1 : -1;
      if (sortBy === "tanggalAsc") return a.tanggal > b.tanggal ? 1 : -1;
      if (sortBy === "jumlahDesc") return b.jumlah - a.jumlah;
      if (sortBy === "jumlahAsc") return a.jumlah - b.jumlah;
      return 0;
    });

    // pagination
    const total = data.length;
    const start = (page - 1) * limit;
    const end = start + limit;
    const paginated = data.slice(start, end);

    return NextResponse.json({
      transaksi: paginated,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: end < total,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { tanggal, jenis, jumlah, kategori, deskripsi } = body;

  // Validasi dasar (FR-20)
  if (!tanggal) return NextResponse.json({ error: "Tanggal wajib diisi." }, { status: 400 });
  if (jenis !== "pemasukan" && jenis !== "pengeluaran")
    return NextResponse.json({ error: "Jenis harus 'pemasukan' atau 'pengeluaran'." }, { status: 400 });
  const jumlahNum = Number(jumlah);
  if (!jumlahNum || jumlahNum <= 0)
    return NextResponse.json({ error: "Jumlah harus angka positif." }, { status: 400 });

  const kategoriMap = await getCategories();
  if (!kategori || !kategoriValid(jenis, kategori, kategoriMap))
    return NextResponse.json({ error: "Kategori wajib dipilih dari daftar yang tersedia." }, { status: 400 });

  const tx = {
    id: randomUUID(),
    tanggal,
    jenis,
    jumlah: jumlahNum,
    kategori,
    deskripsi: deskripsi || kategori,
    chat_asli: "",
    sumber_input: "website_form", // FR-17: tanpa AI, langsung tersimpan
    timestamp_input: new Date().toISOString(),
  };

  try {
    await appendTransaction(tx);
    await clearCachedAnalysis(monthKeyOf(tanggal)); // data berubah -> invalidasi cache analisis (FR-28)
    return NextResponse.json({ transaksi: tx }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
