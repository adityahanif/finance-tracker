import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "./lib/constants";

async function isValidSession(req) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  try {
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  const authed = await isValidSession(req);

  const isApi = pathname.startsWith("/api/");

  if (!authed) {
    if (isApi) {
      return NextResponse.json({ error: "Sesi tidak valid. Masukkan PIN kembali." }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// Hanya rute yang butuh PIN yang lewat middleware ini. Webhook Telegram &
// endpoint auth sengaja TIDAK termasuk — mereka pakai mekanisme sendiri.
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/transactions/:path*",
    "/api/quick-add",
    "/api/analysis/:path*",
    "/api/categories",
    "/api/settings/:path*",
  ],
};