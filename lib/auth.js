import { SignJWT, jwtVerify } from "jose";
import { scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { getSetting, setSetting } from "./sheets";

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

function hashPin(pin) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPinHash(pin, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const attempt = scryptSync(pin, salt, 32);
  const expected = Buffer.from(hash, "hex");
  if (attempt.length !== expected.length) return false;
  return timingSafeEqual(attempt, expected);
}

// PIN sekarang bisa disimpan di Sheets (tab "Pengaturan", key "pin_hash") —
// kalau ada, itu yang dipakai. Kalau belum pernah diganti dari dashboard,
// fallback ke PIN_CODE di environment variable (perbandingan teks biasa).
// Pesan gagal sengaja generik di pemanggilnya (FR-32) — tidak ada info
// percobaan tersisa.
export async function checkPin(pin) {
  if (!pin) return false;
  const stored = await getSetting("pin_hash", null);
  if (stored) return verifyPinHash(pin, stored);
  const envPin = process.env.PIN_CODE;
  return Boolean(envPin) && pin === envPin;
}

export async function changePin(pinLama, pinBaru) {
  const ok = await checkPin(pinLama);
  if (!ok) return false;
  await setSetting("pin_hash", hashPin(pinBaru));
  return true;
}

export function sessionMaxAgeSeconds() {
  return ttlMinutes() * 60;
}