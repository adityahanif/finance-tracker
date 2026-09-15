"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, ComposedChart, Bar, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";

const PALET = ["#2F5233", "#A13D2C", "#2C4A6E", "#8A6D2F", "#5B4636", "#3E6B5E", "#7A3B4E", "#4A5A2F", "#6B4A8A", "#2F6B6E", "#8A5A2F", "#4A4A6E", "#6E6E4A"];
const WARNA_PEMASUKAN = "#2F5233"; // hijau
const WARNA_PENGELUARAN = "#A13D2C"; // merah
const BULAN_ID = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

const todayStr = () => new Date().toISOString().slice(0, 10);
const monthKey = (d) => (d || "").slice(0, 7);
const monthKeyOf = (tanggal) => (tanggal || "").slice(0, 7);
const rupiah = (n) => "Rp" + Math.round(n || 0).toLocaleString("id-ID");
const labelBulan = (key) => { const [y, m] = key.split("-"); return `${BULAN_ID[parseInt(m, 10) - 1]} ${y}`; };

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Terjadi kesalahan.");
  return data;
}

// ---------------------------------------------------------------------------
function StatCard({ label, value, tone }) {
  return (
    <div className={"stat-card tone-" + tone}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{rupiah(value)}</div>
    </div>
  );
}

function MonthNav({ value, onChange, disableNext }) {
  const shift = (delta) => {
    const [y, m] = value.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  return (
    <div className="month-nav">
      <button onClick={() => shift(-1)}>‹</button>
      <span>{labelBulan(value)}</span>
      <button onClick={() => shift(1)} disabled={disableNext}>›</button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Ringkasan({ curMonth, setCurMonth }) {
  const [transaksi, setTransaksi] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);

    api("/api/transactions")
      .then((d) => setTransaksi(d.transaksi))
      .finally(() => setLoading(false));
  }, [curMonth]);

  const transaksiBulanIni = useMemo(() => {
    return transaksi.filter(
      (t) => monthKeyOf(t.tanggal) === curMonth
    );
  }, [transaksi, curMonth]);

  const trend = useMemo(() => {
    const months = [];
    const [y, m] = curMonth.split("-").map(Number);

    for (let i = 5; i >= 0; i--) {
      const d = new Date(y, m - 1 - i, 1);

      months.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      );
    }

    return months.map((mk) => {
      const rows = transaksi.filter(
        (t) => monthKeyOf(t.tanggal) === mk
      );

      return {
        bulan: labelBulan(mk).slice(0, 3),
        Pemasukan: rows
          .filter((t) => t.jenis === "pemasukan")
          .reduce((s, t) => s + t.jumlah, 0),
        Pengeluaran: rows
          .filter((t) => t.jenis === "pengeluaran")
          .reduce((s, t) => s + t.jumlah, 0),
      };
    });
  }, [transaksi, curMonth]);

  const totalMasuk = transaksiBulanIni
    .filter((t) => t.jenis === "pemasukan")
    .reduce((s, t) => s + t.jumlah, 0);

  const totalKeluar = transaksiBulanIni
    .filter((t) => t.jenis === "pengeluaran")
    .reduce((s, t) => s + t.jumlah, 0);

  const pieData = useMemo(() => {
    const map = {};

    transaksiBulanIni
      .filter((t) => t.jenis === "pengeluaran")
      .forEach((t) => {
        map[t.kategori] =
          (map[t.kategori] || 0) + t.jumlah;
      });

    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [transaksiBulanIni]);

  const isCurrentOrFuture =
    curMonth >= monthKey(todayStr());

  return (
    <div className="page">
      <div className="page-head">
        <h2>Ringkasan</h2>
        <MonthNav
          value={curMonth}
          onChange={setCurMonth}
          disableNext={isCurrentOrFuture}
        />
      </div>

      <div className="stat-row">
        <StatCard
          label="Pemasukan"
          value={totalMasuk}
          tone="blue"
        />

        <StatCard
          label="Pengeluaran"
          value={totalKeluar}
          tone="brick"
        />

        <StatCard
          label="Saldo bersih"
          value={totalMasuk - totalKeluar}
          tone="green"
        />
      </div>

      <div className="panel-row">
        <div className="panel">
          <div className="panel-title">
            Pengeluaran per kategori
          </div>

          {loading ? null : pieData.length === 0 ? (
            <div className="empty-mini">
              Belum ada pengeluaran bulan ini.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={1}
                >
                  {pieData.map((_, i) => (
                    <Cell
                      key={i}
                      fill={PALET[i % PALET.length]}
                    />
                  ))}
                </Pie>

                <Tooltip formatter={(v) => rupiah(v)} />

                <Legend
                  layout="vertical"
                  align="right"
                  verticalAlign="middle"
                  wrapperStyle={{ fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="panel">
          <div className="panel-title">
            Tren 6 bulan terakhir
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart
              data={trend}
              margin={{
                top: 5,
                right: 10,
                bottom: 15,
                left: 10,
              }}
            >
              <CartesianGrid
                stroke="#E4E4E4"
                vertical={false}
              />
              <XAxis
                  dataKey="bulan"     
                  tick={{ fontSize: 12 }}
                  axisLine={{ stroke: "#B8B8B8" }} 
                  tickLine={false}
              />
              <YAxis
                tickFormatter={(v) =>
                  v >= 1000000
                    ? `${v / 1000000}jt`
                    : v
                }
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={44}
              />

              <Tooltip formatter={(v) => rupiah(v)} />

              <Legend
                wrapperStyle={{ fontSize: 12 }}
              />

              <Bar
                dataKey="Pemasukan"
                fill={WARNA_PEMASUKAN}
                radius={[3, 3, 0, 0]}
                barSize={22}
              />

              <Bar
                dataKey="Pengeluaran"
                fill={WARNA_PENGELUARAN}
                radius={[3, 3, 0, 0]}
                barSize={22}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Transaksi({ kategoriMap }) {
  const [bulan, setBulan] = useState(monthKey(todayStr()));
  const [kategoriFilter, setKategoriFilter] = useState("Semua");
  const [transaksi, setTransaksi] = useState([]);
  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);

  const muat = useCallback(() => {
    api(`/api/transactions?bulan=${bulan}`).then((d) => setTransaksi(d.transaksi));
  }, [bulan]);

  useEffect(() => { muat(); }, [muat]);

  const semuaKategori = ["Semua", ...kategoriMap.pengeluaran, ...kategoriMap.pemasukan.filter((k) => !kategoriMap.pengeluaran.includes(k))];
  const filtered = transaksi.filter((t) => kategoriFilter === "Semua" || t.kategori === kategoriFilter)
    .sort((a, b) => (a.tanggal < b.tanggal ? 1 : -1));

  const startEdit = (t) => { setEditId(t.id); setEditDraft({ ...t }); };
  const saveEdit = async () => {
    await api(`/api/transactions/${editId}`, { method: "PATCH", body: JSON.stringify(editDraft) });
    setEditId(null); muat();
  };
  const hapus = async (id) => { await api(`/api/transactions/${id}`, { method: "DELETE" }); muat(); };

  return (
    <div className="page">
      <div className="page-head"><h2>Transaksi</h2></div>
      <div className="filter-row">
        <input type="month" value={bulan} onChange={(e) => setBulan(e.target.value)} className="field" style={{ width: 160 }} />
        <select value={kategoriFilter} onChange={(e) => setKategoriFilter(e.target.value)} className="field" style={{ width: 200 }}>
          {semuaKategori.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <span className="filter-count">{filtered.length} entri</span>
      </div>
      <div className="table-wrap">
        {filtered.length === 0 ? (
          <div className="empty-mini">Tidak ada transaksi untuk filter ini.</div>
        ) : (
          <table className="ledger-table">
            <thead>
              <tr><th>Tanggal</th><th>Jenis</th><th>Kategori</th><th>Deskripsi</th><th>Sumber</th><th className="num">Jumlah</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((t) => editId === t.id ? (
                <tr key={t.id} className="editing-row">
                  <td><input type="date" value={editDraft.tanggal} onChange={(e) => setEditDraft({ ...editDraft, tanggal: e.target.value })} className="field sm" /></td>
                  <td>
                    <select value={editDraft.jenis} onChange={(e) => setEditDraft({ ...editDraft, jenis: e.target.value, kategori: (e.target.value === "pemasukan" ? kategoriMap.pemasukan : kategoriMap.pengeluaran)[0] })} className="field sm">
                      <option value="pengeluaran">pengeluaran</option>
                      <option value="pemasukan">pemasukan</option>
                    </select>
                  </td>
                  <td>
                    <select value={editDraft.kategori} onChange={(e) => setEditDraft({ ...editDraft, kategori: e.target.value })} className="field sm">
                      {(editDraft.jenis === "pemasukan" ? kategoriMap.pemasukan : kategoriMap.pengeluaran).map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </td>
                  <td><input value={editDraft.deskripsi} onChange={(e) => setEditDraft({ ...editDraft, deskripsi: e.target.value })} className="field sm" /></td>
                  <td className="muted">{editDraft.sumber_input}</td>
                  <td><input type="number" value={editDraft.jumlah} onChange={(e) => setEditDraft({ ...editDraft, jumlah: Number(e.target.value) })} className="field sm num" /></td>
                  <td className="row-actions">
                    <button onClick={saveEdit}>✓</button>
                    <button onClick={() => setEditId(null)}>✕</button>
                  </td>
                </tr>
              ) : (
                <tr key={t.id}>
                  <td>{t.tanggal}</td>
                  <td><span className={"pill " + (t.jenis === "pemasukan" ? "pill-blue" : "pill-brick")}>{t.jenis}</span></td>
                  <td>{t.kategori}</td>
                  <td className="desc-cell" title={t.deskripsi}>{t.deskripsi}</td>
                  <td className="muted">{t.sumber_input === "telegram" ? "Telegram" : t.sumber_input === "website_quick_add" ? "Tambah cepat" : "Form"}</td>
                  <td className={"num " + (t.jenis === "pemasukan" ? "text-blue" : "text-brick")}>{t.jenis === "pemasukan" ? "+" : "-"}{rupiah(t.jumlah)}</td>
                  <td className="row-actions">
                    <button onClick={() => startEdit(t)}>✎</button>
                    <button onClick={() => hapus(t.id)}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Tambah({ kategoriMap, onSaved }) {
  const [jenis, setJenis] = useState("pengeluaran");
  const [tanggal, setTanggal] = useState(todayStr());
  const [jumlah, setJumlah] = useState("");
  const [kategori, setKategori] = useState(kategoriMap.pengeluaran[0] || "");
  const [deskripsi, setDeskripsi] = useState("");
  const [formErr, setFormErr] = useState("");

  const [teks, setTeks] = useState("");
  const [loadingQuick, setLoadingQuick] = useState(false);
  const [quickErr, setQuickErr] = useState("");
  const [quickOk, setQuickOk] = useState("");

  const daftar = jenis === "pemasukan" ? kategoriMap.pemasukan : kategoriMap.pengeluaran;

  const submitForm = async (e) => {
    e.preventDefault();
    setFormErr("");
    try {
      await api("/api/transactions", { method: "POST", body: JSON.stringify({ tanggal, jenis, jumlah: Number(jumlah), kategori, deskripsi }) });
      setJumlah(""); setDeskripsi(""); onSaved?.();
    } catch (err) {
      setFormErr(err.message);
    }
  };

  const submitQuick = async (e) => {
    e.preventDefault();
    if (!teks.trim()) return;
    setLoadingQuick(true); setQuickErr(""); setQuickOk("");
    try {
      const hasil = await api("/api/quick-add", { method: "POST", body: JSON.stringify({ text: teks.trim() }) });
      setQuickOk(`Tercatat ${hasil.transaksi.length} transaksi.`);
      setTeks(""); onSaved?.();
    } catch (err) {
      setQuickErr(err.message);
    } finally {
      setLoadingQuick(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head"><h2>Tambah transaksi</h2></div>
      <div className="panel-row">
        <div className="panel">
          <div className="panel-title">Tambah cepat</div>
          <p className="panel-hint">Ketik seperti chat biasa, mis. &quot;bakso 15rb sama es teh 5rb&quot;.</p>
          <form onSubmit={submitQuick} className="quick-form">
            <textarea value={teks} onChange={(e) => setTeks(e.target.value)} placeholder="50000 beli bakso" rows={3} className="field" />
            <button type="submit" className="btn-primary" disabled={loadingQuick}>{loadingQuick ? "Memproses…" : "Catat"}</button>
          </form>
          {quickErr && <div className="form-error">{quickErr}</div>}
          {quickOk && <div className="form-ok">{quickOk}</div>}
        </div>
        <div className="panel">
          <div className="panel-title">Form terstruktur</div>
          <form onSubmit={submitForm} className="struct-form">
            <label>Jenis
              <select value={jenis} onChange={(e) => { setJenis(e.target.value); setKategori((e.target.value === "pemasukan" ? kategoriMap.pemasukan : kategoriMap.pengeluaran)[0] || ""); }} className="field">
                <option value="pengeluaran">Pengeluaran</option>
                <option value="pemasukan">Pemasukan</option>
              </select>
            </label>
            <label>Tanggal<input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} className="field" /></label>
            <label>Jumlah (Rp)<input type="number" min="0" value={jumlah} onChange={(e) => setJumlah(e.target.value)} placeholder="0" className="field" /></label>
            <label>Kategori
              <select value={kategori} onChange={(e) => setKategori(e.target.value)} className="field">
                {daftar.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <label>Deskripsi<input value={deskripsi} onChange={(e) => setDeskripsi(e.target.value)} placeholder="opsional" className="field" /></label>
            {formErr && <div className="form-error">{formErr}</div>}
            <button type="submit" className="btn-primary">Simpan transaksi</button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function AnalisisAI({ curMonth }) {
  const [teks, setTeks] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    setLoading(true); setTeks(null);
    api(`/api/analysis?bulan=${curMonth}`).then((d) => setTeks(d.teks)).finally(() => setLoading(false));
  }, [curMonth]);

  const jalankan = async () => {
    setLoading(true); setErr("");
    try {
      const d = await api("/api/analysis", { method: "POST", body: JSON.stringify({ bulan: curMonth }) });
      setTeks(d.teks);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head"><h2>Analisis AI — {labelBulan(curMonth)}</h2></div>
      <div className="panel analysis-panel">
        {loading ? null : teks ? (
          <>
            <p className="analysis-text">{teks}</p>
            <button className="btn-secondary" onClick={jalankan}>Buat ulang analisis</button>
          </>
        ) : (
          <>
            <p className="panel-hint">Ringkas pola pengeluaran bulan ini dibanding bulan lalu, dan dapatkan saran singkat.</p>
            <button className="btn-primary" onClick={jalankan}>Jalankan Analisis AI</button>
          </>
        )}
        {err && <div className="form-error">{err}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Pengaturan() {
  const [parseModel, setParseModel] = useState("");
  const [analysisModel, setAnalysisModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/api/settings").then((d) => {
      setParseModel(d.gemini_parse_model);
      setAnalysisModel(d.gemini_analysis_model);
    }).finally(() => setLoading(false));
  }, []);

  const simpan = async (e) => {
    e.preventDefault();
    setSaving(true); setMsg(""); setErr("");
    try {
      await api("/api/settings", { method: "POST", body: JSON.stringify({ gemini_parse_model: parseModel, gemini_analysis_model: analysisModel }) });
      setMsg("Tersimpan.");
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head"><h2>Pengaturan</h2></div>
      <div className="panel" style={{ maxWidth: 480 }}>
        <div className="panel-title">Model Gemini</div>
        <p className="panel-hint">Nama model harus sesuai yang tersedia untuk API key kamu (cek di Google AI Studio).</p>
        {loading ? null : (
          <form onSubmit={simpan} className="struct-form">
            <label>Model untuk parsing pesan
              <input value={parseModel} onChange={(e) => setParseModel(e.target.value)} className="field" placeholder="gemini-3.5-flash-lite" />
            </label>
            <label>Model untuk analisis AI
              <input value={analysisModel} onChange={(e) => setAnalysisModel(e.target.value)} className="field" placeholder="gemini-3.8-flash" />
            </label>
            {err && <div className="form-error">{err}</div>}
            {msg && <div className="form-ok">{msg}</div>}
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Menyimpan…" : "Simpan"}</button>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function DashboardClient() {
  const [tab, setTab] = useState("ringkasan");
  const [curMonth, setCurMonth] = useState(monthKey(todayStr()));
  const [refreshKey, setRefreshKey] = useState(0);
  const [kategoriMap, setKategoriMap] = useState({ pengeluaran: [], pemasukan: [] });

  useEffect(() => {
    api("/api/categories").then(setKategoriMap);
  }, [refreshKey]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">Rp</div>
          <div>
            <div className="brand-title">Buku Kas</div>
            <div className="brand-sub">Pencatat keuangan pribadi</div>
          </div>
        </div>
        <nav className="tabs">
          {[["ringkasan", "Ringkasan"], ["transaksi", "Transaksi"], ["tambah", "Tambah"], ["analisis", "Analisis AI"], ["pengaturan", "Pengaturan"]].map(([k, label]) => (
            <button key={k} className={"tab" + (tab === k ? " active" : "")} onClick={() => setTab(k)}>{label}</button>
          ))}
        </nav>
        <div className="sidebar-foot">Data tersimpan di Google Sheets.</div>
      </aside>
      <main className="content">
        {tab === "ringkasan" && <Ringkasan key={refreshKey} curMonth={curMonth} setCurMonth={setCurMonth} />}
        {tab === "transaksi" && <Transaksi key={refreshKey} kategoriMap={kategoriMap} />}
        {tab === "tambah" && <Tambah kategoriMap={kategoriMap} onSaved={() => setRefreshKey((k) => k + 1)} />}
        {tab === "analisis" && <AnalisisAI curMonth={curMonth} />}
        {tab === "pengaturan" && <Pengaturan />}
      </main>
    </div>
  );
}
