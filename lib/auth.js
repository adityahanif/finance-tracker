import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "fintrack_session";

function getSecretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET belum diisi di environment variable.");
  return new TextEncoder().encode(secret);
}

function ttlMinutes() {
  return Number(process.env.SESSION_TTL_MINUTES || 30);
}

export async function createSessionToken() {
  return new SignJWT({ ok: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlMinutes()}m`)
    .sign(getSecretKey());
}

export async function verifySessionToken(token) {
  if (!token) return false;
  try {
    await jwtVerify(token, getSecretKey());
    return true;
  } catch {
    return false;
  }
}

// Perbandingan PIN sederhana. Pesan error sengaja generik (FR-32) — tidak ada
// info percobaan tersisa yang bisa dimanfaatkan untuk brute force.
export function checkPin(pin) {
  const expected = process.env.PIN_CODE;
  return Boolean(expected) && pin === expected;
}

export function sessionMaxAgeSeconds() {
  return ttlMinutes() * 60;
}
