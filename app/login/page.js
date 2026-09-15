"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        router.push("/dashboard");
      } else {
        setError("PIN salah."); // generik, tanpa info percobaan (FR-32)
        setPin("");
      }
    } catch {
      setError("Gagal menghubungi server, coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pin-screen">
      <div className="pin-card">
        <div className="pin-stamp">🔒</div>
        <h1>Masukkan PIN</h1>
        <p className="pin-sub">Buku kas ini terkunci.</p>
        <form onSubmit={submit}>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            className="pin-input"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            autoFocus
          />
          <button type="submit" className="btn-primary" style={{ width: "100%", marginTop: 16 }} disabled={loading || pin.length === 0}>
            {loading ? "Memeriksa…" : "Buka"}
          </button>
        </form>
        {error && <div className="pin-error">{error}</div>}
      </div>
    </div>
  );
}
