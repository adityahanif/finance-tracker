import { NextResponse } from "next/server";
import { changePin } from "../../../../lib/auth";

export async function POST(req) {
  const { pinLama, pinBaru } = await req.json().catch(() => ({}));
  if (!pinBaru || pinBaru.length < 4) {
    return NextResponse.json({ error: "PIN baru minimal 4 digit." }, { status: 400 });
  }
  const ok = await changePin(pinLama, pinBaru);
  if (!ok) return NextResponse.json({ error: "PIN lama salah." }, { status: 401 });
  return NextResponse.json({ ok: true });
}