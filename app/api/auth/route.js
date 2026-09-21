import { NextResponse } from "next/server";
import { checkPin, createSessionToken, sessionMaxAgeSeconds, SESSION_COOKIE } from "../../../lib/auth";

export async function POST(req) {
  const { pin } = await req.json().catch(() => ({}));

  if (!(await checkPin(pin))) {
    return NextResponse.json({ ok: false, error: "PIN salah." }, { status: 401 });
  }

  const token = await createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: sessionMaxAgeSeconds(),
  });
  return res;
}
