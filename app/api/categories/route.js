import { NextResponse } from "next/server";
import { getCategories, addCategory, deleteCategory } from "../../../lib/sheets";

export async function GET() {
  try {
    const data = await getCategories();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { jenis, kategori } = await req.json().catch(() => ({}));
    const nama = await addCategory(jenis, kategori);
    return NextResponse.json({ ok: true, kategori: nama }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const jenis = searchParams.get("jenis");
    const kategori = searchParams.get("kategori");

    const ok = await deleteCategory(jenis, kategori);
    if (!ok) {
      return NextResponse.json({ error: "Kategori tidak ditemukan." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
