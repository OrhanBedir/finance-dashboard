// İş avansı red → düzelt → yeniden gönder akışı ve sürümlü onay turları (02.11.2026, Orhan şartnamesi)
//
// Sorun: reddedilen iş avansı personelin ekranında yalnız "Reddedildi" rozetiyle (mobilde gerekçesiz) görünüyor, kaybolup
// gidiyordu; red gerekçesi / reddeden / aşama tek yerde tutulmuyordu; düzeltip yeniden göndermenin tek yolu YENİ talep açmaktı
// (geçmiş kopuyor, mükerrer kayıt). Bu modül mevcut is_avans_talep kaydını TEK KİMLİK altında tutar; her gönderim ayrı bir
// "tur"dur (is_avans_tur): ilk talep 1. gönderim, red sonrası düzeltme 2. gönderim, ... Eski onay / red kayıtları değişmez.
//
// Kurallar
//  - Red gerekçesi zorunlu; red kaydında aşama (RM/PM/PD/ODE), reddeden hesap ve zaman tutulur (is_avans_tur + ana satır).
//  - Yalnız talebin SAHİBİ (talep eden hesabın e-postası ya da avansın üzerindeki personelin hesabı — kimlikle, görünen adla değil)
//    ve yalnız durum REDDEDILDI iken "düzelt ve yeniden gönder" yapabilir. Ödenmiş / onay sürecindeki talep bu yolla açılmaz.
//  - Yeniden gönderimde düzeltme açıklaması zorunlu; önceki açıklama ve red gerekçesi tur kaydında korunur (üzerine yazılmaz).
//  - Yeniden gönderim yeni onay turudur: eski onay tarihleri / onaylayanlar ana satırdan temizlenir (geçmişte ve tur kaydında durur),
//    durum ilk aşamaya döner (Orhan'ın kendi talebi mevcut kuralla PM aşamasını geçmiş başlar); Teknocenter zinciri atlanan
//    aşamaları yine bekletmez (teknoOnay.normalize). Zincir güncel personel / firma bilgisinden yeniden hesaplanır.
//  - Eski turun açık ekranı yeni turu onaylayamaz / reddedemez: istemci tur_no gönderirse ve aktif tur farklıysa 409.
//  - Mükerrer gönderim: istek_anahtari (istemci üretir) aynıysa ikinci istek yeni tur açmaz, mevcut sonucu döner; ayrıca
//    durum/sürüm koşullu UPDATE (FOR UPDATE kilidi) eş zamanlı ikinci isteği 409 ile durdurur.
//  - Reddedilen talep sahibi tarafından silinemez (geçmiş kaybolmasın); yönetim (tam görüş) silebilir — mevcut davranış.
//  - Fiyat / maaş gizliliği, firma kapsamı (kapsamKapisi) ve Orhan'ın kişisel kayıt gizliliği aynen uygulanır.
const ASAMA_TR_ERC = { RM: "Rollout müdürü onayı", PM: "PM onayı", PD: "Direktör onayı", ODE: "Ödeme (muhasebe)" };
const ASAMA_TR_TEKNO = { RM: "Bölge / rollout müdürü onayı", PM: "Orhan Bedir (PM) onayı", PD: "İlhami Şahin (Teknocenter direktörü) onayı", ODE: "Ödeme — Teknocenter muhasebesi" };
const DURUM_ASAMA = { TALEP: "RM", ROLLOUT_MUDUR_ONAY: "PM", PM_ONAY: "PD", DIREKTOR_ONAY: "ODE" };
// Personelin düzeltebileceği alanlar (tutar, tarih, gider türü, bölge, proje, plaka, km, açıklama, not, son ödeme günü)
const DUZENLENEBILIR = ["tutar", "tarih", "gider_turu", "bolge", "proje", "plaka", "arac_km", "aciklama", "not_aciklama", "son_odeme_tarihi"];
const ALAN_TR = { tutar: "Tutar", tarih: "Tarih", gider_turu: "Gider türü", bolge: "Bölge", proje: "Proje", plaka: "Plaka", arac_km: "Araç KM",
  aciklama: "Açıklama", not_aciklama: "Not", son_odeme_tarihi: "Son ödeme günü", firma: "Firma" };
const ESKI_KAYIT_NOTU = "Eski kayıtta red gerekçesi bulunmuyor";

const _e = (v) => String(v || "").toLowerCase().trim();
const _uid = (u) => Number(u?.user_id || u?.id || 0) || null;
const _ymd = (v) => { if (!v) return null; if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`; return String(v).slice(0, 10); };
const asamaTr = (asama, akis) => (asama ? (akis === "TEKNO" ? ASAMA_TR_TEKNO : ASAMA_TR_ERC)[asama] || asama : null);

// Gönderim anındaki alanlar (tur kaydı ve karşılaştırma için)
function alanlar(t) {
  if (!t) return null;
  const n = (v) => (v === undefined ? null : v);
  return { tutar: t.tutar != null ? Number(t.tutar) : null, tarih: _ymd(t.tarih), gider_turu: n(t.gider_turu), bolge: n(t.bolge), proje: n(t.proje),
    plaka: n(t.plaka), arac_km: t.arac_km != null ? Number(t.arac_km) : null, aciklama: n(t.aciklama), not_aciklama: n(t.not_aciklama),
    son_odeme_tarihi: _ymd(t.son_odeme_tarihi), firma: n(t.firma), personel_id: t.personel_id ?? null };
}
// Önceki/yeni alan farkı: { alan: { eski, yeni } } (yalnız değişenler)
function fark(eski, yeni) {
  const d = {}; const e = eski || {}, y = yeni || {};
  for (const k of [...DUZENLENEBILIR, "firma"]) {
    const a = e[k] == null || e[k] === "" ? null : e[k], b = y[k] == null || y[k] === "" ? null : y[k];
    if (String(a ?? "") !== String(b ?? "")) d[k] = { eski: a, yeni: b };
  }
  return d;
}

async function semaKur(pool) {
  const q = (s) => pool.query(s).catch((e) => console.error("[avans-tur şema]", e.message));
  await q(`ALTER TABLE is_avans_talep ADD COLUMN IF NOT EXISTS aktif_tur_no INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS surum INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS red_asama TEXT, ADD COLUMN IF NOT EXISTS red_zamani TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS reddeden_user_id INTEGER`);
  await q(`CREATE TABLE IF NOT EXISTS is_avans_tur (
    id SERIAL PRIMARY KEY,
    talep_id INTEGER NOT NULL REFERENCES is_avans_talep(id) ON DELETE CASCADE,
    tur_no INTEGER NOT NULL,
    gonderim_zamani TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    gonderen_email TEXT, gonderen_user_id INTEGER,
    gonderim_aciklama TEXT,
    alanlar JSONB, degisen JSONB, zincir JSONB,
    istek_anahtari TEXT,
    sonuc TEXT, sonuc_zamani TIMESTAMPTZ,
    red_aciklama TEXT, reddeden_email TEXT, reddeden_user_id INTEGER, red_asama TEXT, red_asama_tr TEXT, red_akis TEXT,
    UNIQUE (talep_id, tur_no))`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS is_avans_tur_acik_idx ON is_avans_tur (talep_id) WHERE sonuc IS NULL`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS is_avans_tur_istek_idx ON is_avans_tur (istek_anahtari) WHERE istek_anahtari IS NOT NULL`);
  await q(`ALTER TABLE is_avans_tur ENABLE ROW LEVEL SECURITY`);
}

function kur(app, c) {
  const { pool, authMiddleware, islemGecmisiYaz } = c;
  const hata = (res, kod, mesaj, ek) => res.status(kod).json({ ok: false, error: mesaj, ...(ek || {}) });
  let tekno = null; const teknoBagla = (t) => { tekno = t; };

  // ── Sahiplik: kimlikle (hesap e-postası / personel kartındaki user_id ya da e-posta) ──
  async function sahipMi(u, t, db = pool) {
    if (!u || !t) return false;
    const ben = _e(u.email), uid = _uid(u);
    if (ben && _e(t.talep_eden_email) === ben) return true;
    if (!t.personel_id) return false;
    const p = (await db.query(`SELECT user_id, LOWER(TRIM(COALESCE(email,''))) AS email FROM personel WHERE id=$1`, [t.personel_id])).rows[0];
    return !!p && ((uid && Number(p.user_id) === uid) || (!!ben && p.email === ben));
  }

  // ── Aktif tur kaydını garanti et (eski kayıtlarda tur satırı yoktur: 1. gönderim talep anından sentezlenir) ──
  async function turSagla(db, t) {
    const no = Number(t.aktif_tur_no || 1);
    const var_ = (await db.query(`SELECT id FROM is_avans_tur WHERE talep_id=$1 AND tur_no=$2`, [t.id, no])).rows[0];
    if (var_) return no;
    await db.query(`INSERT INTO is_avans_tur (talep_id, tur_no, gonderim_zamani, gonderen_email, alanlar) VALUES ($1,$2,COALESCE($3,NOW()),$4,$5)
      ON CONFLICT (talep_id, tur_no) DO NOTHING`, [t.id, no, t.created_at || null, _e(t.talep_eden_email) || null, JSON.stringify(alanlar(t))]);
    return no;
  }

  // ── Red kaydı: ana satır (aşama / zaman / reddeden) + aktif tur kapanışı. Ana satırın durum=REDDEDILDI güncellemesi çağıranda. ──
  async function reddiKaydet(req, talep, { asama, akis, aciklama }) {
    const u = req.user || {};
    const no = await turSagla(pool, talep);
    const tr = asamaTr(asama, akis);
    await pool.query(`UPDATE is_avans_tur SET sonuc='REDDEDILDI', sonuc_zamani=NOW(), red_aciklama=$3, reddeden_email=$4, reddeden_user_id=$5,
        red_asama=$6, red_asama_tr=$7, red_akis=$8 WHERE talep_id=$1 AND tur_no=$2`,
      [talep.id, no, aciklama || null, _e(u.email) || null, _uid(u), asama || null, tr, akis || "ERC"]).catch((e) => console.error("[avans-tur red]", e.message));
    await pool.query(`UPDATE is_avans_talep SET red_asama=$2, red_zamani=NOW(), reddeden_user_id=$3, surum=COALESCE(surum,1)+1 WHERE id=$1`,
      [talep.id, asama || null, _uid(u)]).catch((e) => console.error("[avans-tur red2]", e.message));
    return { tur_no: no, asama, asama_tr: tr };
  }
  // Ödeme tamamlandığında aktif tur kapanır (geçmiş görünümünde "sonuç: ödendi")
  async function turKapat(talep, sonuc = "ONAYLANDI") {
    try { const no = await turSagla(pool, talep); await pool.query(`UPDATE is_avans_tur SET sonuc=$3, sonuc_zamani=NOW() WHERE talep_id=$1 AND tur_no=$2 AND sonuc IS NULL`, [talep.id, no, sonuc]); } catch (e) { console.error("[avans-tur kapat]", e.message); }
  }
  // Yeni talepte 1. tur kaydı (istek anahtarıyla)
  // Dönüş: { ok } ya da { mukerrer: true } (aynı istek anahtarı eş zamanlı başka bir istekte önce yazıldı — çağıran mükerrer talebi siler)
  async function ilkTur(req, talep, istekAnahtari) {
    try {
      await pool.query(`INSERT INTO is_avans_tur (talep_id, tur_no, gonderen_email, gonderen_user_id, alanlar, istek_anahtari) VALUES ($1,1,$2,$3,$4,$5) ON CONFLICT (talep_id, tur_no) DO NOTHING`,
        [talep.id, _e(req.user?.email) || _e(talep.talep_eden_email) || null, _uid(req.user), JSON.stringify(alanlar(talep)), istekAnahtari || null]);
      return { ok: true };
    } catch (e) {
      if (istekAnahtari && /is_avans_tur_istek_idx|duplicate key/i.test(e.message)) return { mukerrer: true };
      console.error("[avans-tur ilk]", e.message); return { ok: false };
    }
  }
  // Aynı istek anahtarıyla daha önce açılmış talep (POST tekrarı: bağlantı kopması / çift dokunma)
  async function anahtarlaTalep(istekAnahtari) {
    if (!istekAnahtari) return null;
    const r = await pool.query(`SELECT t.* FROM is_avans_tur x JOIN is_avans_talep t ON t.id = x.talep_id WHERE x.istek_anahtari=$1 LIMIT 1`, [String(istekAnahtari).slice(0, 120)]).catch(() => ({ rows: [] }));
    return r.rows[0] || null;
  }

  // ── Tur kontrolü (onay / red uçları): istemci hangi turu gördüğünü söylerse, eski tur yeni turu işleyemez. Yanıt verildiyse true. ──
  function turKontrol(req, res, talep) {
    const g = req.body?.tur_no;
    if (g === undefined || g === null || g === "") return false;
    const aktif = Number(talep.aktif_tur_no || 1);
    if (Number(g) === aktif) return false;
    hata(res, 409, `Bu talep düzeltilip yeniden gönderildi (${aktif}. gönderim); eski ekrandaki ${Number(g)}. gönderim üzerinden onay / red verilemez. Listeyi yenileyin.`, { guncel_tur: aktif, guncel_durum: talep.durum });
    return true;
  }

  // ── Satırlara tur / red bilgisi ekler (liste, özet, mobil pano, bekleyen onaylar) ──
  // Eklenen alanlar: tur_no, gonderim_sayisi, gonderim {tur_no, aciklama, zaman, gonderen, degisen}, onceki_red {…}, red {…},
  // sahibi (oturum verildiyse), duzeltilebilir. Alanlar yalnız okunur bilgi; fiyat / maaş içermez.
  async function turBilgisiEkle(req, rows) {
    if (!Array.isArray(rows) || !rows.length) return rows;
    const ids = [...new Set(rows.map((x) => Number(x.id)).filter(Boolean))];
    if (!ids.length) return rows;
    const [ana, turlar, redLog] = await Promise.all([
      pool.query(`SELECT t.id, t.durum, t.aktif_tur_no, t.surum, t.red_aciklama, t.reddeden_email, t.red_asama, t.red_zamani, t.reddeden_user_id, t.talep_eden_email,
          t.personel_id, LOWER(TRIM(COALESCE(p.email,''))) AS p_email, p.user_id AS p_uid FROM is_avans_talep t LEFT JOIN personel p ON p.id = t.personel_id WHERE t.id = ANY($1)`, [ids]),
      pool.query(`SELECT * FROM is_avans_tur WHERE talep_id = ANY($1) ORDER BY talep_id, tur_no`, [ids]).catch(() => ({ rows: [] })),
      pool.query(`SELECT kayit_id, created_at, kullanici, yeni->>'adim' AS adim, yeni->>'akis' AS akis FROM islem_gecmisi WHERE modul='avans' AND tip='RED' AND kayit_id = ANY($1) ORDER BY id`, [ids]).catch(() => ({ rows: [] })),
    ]);
    const emails = new Set();
    for (const r of ana.rows) if (r.reddeden_email) emails.add(_e(r.reddeden_email));
    for (const r of turlar.rows) { if (r.reddeden_email) emails.add(_e(r.reddeden_email)); if (r.gonderen_email) emails.add(_e(r.gonderen_email)); }
    for (const r of redLog.rows) if (r.kullanici) emails.add(_e(r.kullanici));
    const adMap = new Map();
    if (emails.size) { const u = await pool.query(`SELECT LOWER(TRIM(email)) AS email, name FROM users WHERE LOWER(TRIM(email)) = ANY($1)`, [[...emails]]).catch(() => ({ rows: [] })); for (const x of u.rows) adMap.set(x.email, x.name); }
    const ad = (e) => (e ? adMap.get(_e(e)) || e : null);
    const anaMap = new Map(ana.rows.map((r) => [Number(r.id), r]));
    const turMap = new Map(); for (const r of turlar.rows) { const l = turMap.get(Number(r.talep_id)) || []; l.push(r); turMap.set(Number(r.talep_id), l); }
    const logMap = new Map(); for (const r of redLog.rows) logMap.set(Number(r.kayit_id), r); // en son RED kaydı
    const u = req?.user || null; const ben = _e(u?.email), uid = _uid(u);
    return rows.map((x) => {
      const a = anaMap.get(Number(x.id)); if (!a) return x;
      const tl = turMap.get(Number(x.id)) || [];
      const aktif = Number(a.aktif_tur_no || 1);
      const sayi = Math.max(aktif, ...tl.map((r) => Number(r.tur_no)));
      const aktifTur = tl.find((r) => Number(r.tur_no) === aktif) || null;
      const oncekiRedTur = [...tl].reverse().find((r) => Number(r.tur_no) < aktif && r.sonuc === "REDDEDILDI") || null;
      const log = logMap.get(Number(x.id)) || null;
      const tekno = x.tekno || null;
      let red = null;
      if (a.durum === "REDDEDILDI") {
        const asama = a.red_asama || aktifTur?.red_asama || log?.adim || null;
        const akis = aktifTur?.red_akis || log?.akis || (tekno ? "TEKNO" : "ERC");
        const zaman = a.red_zamani || aktifTur?.sonuc_zamani || log?.created_at || null;
        red = { tur_no: aktif, aciklama: a.red_aciklama || aktifTur?.red_aciklama || null, reddeden_email: a.reddeden_email || aktifTur?.reddeden_email || log?.kullanici || null,
          reddeden_ad: ad(a.reddeden_email || aktifTur?.reddeden_email || log?.kullanici), zaman, asama, asama_tr: asamaTr(asama, akis),
          eski_kayit: !zaman && !asama, not: !(a.red_aciklama || aktifTur?.red_aciklama) ? ESKI_KAYIT_NOTU : null };
      }
      const sahibi = u ? (!!ben && _e(a.talep_eden_email) === ben) || (!!a.personel_id && ((uid && Number(a.p_uid) === uid) || (!!ben && a.p_email === ben))) : undefined;
      return {
        ...x, tur_no: aktif, gonderim_sayisi: sayi, surum: a.surum ?? 1,
        gonderim: aktif > 1 && aktifTur ? { tur_no: aktif, aciklama: aktifTur.gonderim_aciklama || null, zaman: aktifTur.gonderim_zamani, gonderen_email: aktifTur.gonderen_email || null, gonderen_ad: ad(aktifTur.gonderen_email), degisen: aktifTur.degisen || null } : null,
        onceki_red: oncekiRedTur ? { tur_no: Number(oncekiRedTur.tur_no), aciklama: oncekiRedTur.red_aciklama || null, reddeden_email: oncekiRedTur.reddeden_email || null, reddeden_ad: ad(oncekiRedTur.reddeden_email),
          zaman: oncekiRedTur.sonuc_zamani, asama: oncekiRedTur.red_asama || null, asama_tr: oncekiRedTur.red_asama_tr || asamaTr(oncekiRedTur.red_asama, oncekiRedTur.red_akis) } : null,
        red,
        ...(u ? { sahibi: !!sahibi, duzeltilebilir: !!sahibi && a.durum === "REDDEDILDI" } : {}),
      };
    });
  }

  // Zincir özeti (tur kaydına): Teknocenter zinciri → teknoOnay bilgisi; aksi hâlde eski ERC sırası
  async function zincirOzeti(req, id) {
    try {
      const t = tekno ? await tekno.tekBilgi(req, "avans", id) : null;
      if (t) return { akis: "TEKNO", asama: t.bilgi.asama, asamalar: t.bilgi.zincir.map((z) => ({ k: z.k, ad: z.ad, kisiler: z.kisiler, atlandi: z.atlandi, durum: z.durum })) };
    } catch (e) { console.error("[avans-tur zincir]", e.message); }
    return { akis: "ERC", asamalar: Object.entries(ASAMA_TR_ERC).map(([k, ad]) => ({ k, ad })) };
  }

  // ── Düzelt ve yeniden gönder ──
  app.put("/hr/is-avans/:id/yeniden-gonder", authMiddleware, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return hata(res, 400, "Geçersiz talep");
    if (c.taseronMu(req.user)) return hata(res, 403, "Taşeron hesabı bu işlemi yapamaz");
    const b = req.body || {};
    const aciklama = String(b.gonderim_aciklama || "").trim();
    const istekAnahtari = b.istek_anahtari ? String(b.istek_anahtari).slice(0, 120) : null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const t = (await client.query(`SELECT * FROM is_avans_talep WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!t) { await client.query("ROLLBACK"); return hata(res, 404, "Kayıt bulunamadı"); }
      if (!(await sahipMi(req.user, t, client))) { await client.query("ROLLBACK"); return hata(res, 403, "Yalnız talebin sahibi düzeltip yeniden gönderebilir"); }
      const kap = c.altMarkaKapsam(req);
      if (kap) {
        const pm = (await client.query(`SELECT COALESCE(marka,'ERC') AS m FROM personel WHERE id=$1`, [t.personel_id]).catch(() => ({ rows: [] }))).rows[0];
        if (!c.avansKapsamda(kap, { ...t, personel_marka: pm?.m || "ERC" })) { await client.query("ROLLBACK"); return hata(res, 403, "Bu talep firmanızın kapsamında değil"); }
      }
      // Tekrar isteği (aynı anahtar): yeni tur açılmaz, mevcut durum döner
      if (istekAnahtari) {
        const ayni = (await client.query(`SELECT tur_no FROM is_avans_tur WHERE talep_id=$1 AND istek_anahtari=$2`, [id, istekAnahtari])).rows[0];
        if (ayni) { await client.query("ROLLBACK"); const rows = await turBilgisiEkle(req, [t]); return res.json({ ok: true, tekrar: true, tur_no: Number(ayni.tur_no), talep: rows[0] }); }
      }
      if (t.durum === "TAMAMLANDI") { await client.query("ROLLBACK"); return hata(res, 409, "Ödenmiş talep yeniden açılamaz"); }
      if (t.durum !== "REDDEDILDI") { await client.query("ROLLBACK"); return hata(res, 409, "Yalnız reddedilmiş talep düzeltilip yeniden gönderilir (talep şu an onay sürecinde)", { guncel_durum: t.durum }); }
      if (b.surum !== undefined && b.surum !== null && Number(b.surum) !== Number(t.surum || 1)) { await client.query("ROLLBACK"); return hata(res, 409, "Talep bu arada değişti; güncel hâlini yükleyip yeniden deneyin", { guncel_surum: t.surum }); }
      if (aciklama.length < 3) { await client.query("ROLLBACK"); return hata(res, 400, "Düzeltme / yeniden talep açıklaması zorunlu"); }
      // Yeni alanlar: gönderilen alan güncellenir, gönderilmeyen korunur
      const eski = alanlar(t);
      const yeni = { ...eski };
      if ("tutar" in b) { const v = Number(String(b.tutar ?? "").replace(/\./g, (m, i, s) => (s.includes(",") ? "" : m)).replace(",", ".")); if (!(v > 0)) { await client.query("ROLLBACK"); return hata(res, 400, "Geçerli tutar girin"); } yeni.tutar = v; }
      if ("tarih" in b) { const v = _ymd(b.tarih); if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ""))) { await client.query("ROLLBACK"); return hata(res, 400, "Geçerli tarih girin"); } yeni.tarih = v; }
      if ("son_odeme_tarihi" in b) { const v = c.avansVadeGirdisi(b.son_odeme_tarihi); if (v === undefined) { await client.query("ROLLBACK"); return hata(res, 400, "Son ödeme günü geçersiz"); } yeni.son_odeme_tarihi = v; }
      for (const k of ["gider_turu", "bolge", "proje", "aciklama", "not_aciklama"]) if (k in b) yeni[k] = b[k] == null || String(b[k]).trim() === "" ? null : String(b[k]).trim().slice(0, 2000);
      if ("plaka" in b) yeni.plaka = b.plaka ? String(b.plaka).trim().toUpperCase().replace(/\s+/g, " ") : null;
      if ("arac_km" in b) yeni.arac_km = b.arac_km == null || b.arac_km === "" || isNaN(Number(b.arac_km)) ? null : Number(b.arac_km);
      if ("firma" in b && b.firma) { const f = c.normalizeAvansFirma(b.firma); if (f) yeni.firma = f; }
      if (kap && yeni.firma && yeni.firma !== kap.kod) { await client.query("ROLLBACK"); return hata(res, 403, "Alt marka hesabı başka firmanın kasasını seçemez"); } // ödeme kaynağı onayda zincirce kilitlenir
      const degisen = fark(eski, yeni);
      // Onay turu yeniden başlar (Orhan'ın kendi talebi: mevcut kural, PM aşaması geçilmiş)
      const bugun = c.istanbulBugun();
      const orhanMi = ["orhan.bedir@simsektel.com", "orhan.bedir@gmail.com"].includes(_e(t.talep_eden_email)) && ["orhan.bedir@simsektel.com", "orhan.bedir@gmail.com"].includes(_e(req.user?.email));
      const yeniDurum = orhanMi ? "PM_ONAY" : "TALEP";
      const oncekiTur = await turSagla(client, t); // eski red turu kaydı (yoksa sentezlenir; red bilgisi aşağıda kopyalanır)
      await client.query(`UPDATE is_avans_tur SET sonuc=COALESCE(sonuc,'REDDEDILDI'), sonuc_zamani=COALESCE(sonuc_zamani,$3), red_aciklama=COALESCE(red_aciklama,$4), reddeden_email=COALESCE(reddeden_email,$5),
          reddeden_user_id=COALESCE(reddeden_user_id,$6), red_asama=COALESCE(red_asama,$7), red_asama_tr=COALESCE(red_asama_tr,$8) WHERE talep_id=$1 AND tur_no=$2`,
        [id, oncekiTur, t.red_zamani || null, t.red_aciklama || null, t.reddeden_email || null, t.reddeden_user_id || null, t.red_asama || null, asamaTr(t.red_asama, null)]);
      const yeniTur = oncekiTur + 1;
      const u = await client.query(`UPDATE is_avans_talep SET tutar=$2, tarih=$3, gider_turu=$4, bolge=$5, proje=$6, plaka=$7, arac_km=$8, aciklama=$9, not_aciklama=$10, son_odeme_tarihi=$11, firma=$12,
          durum=$13, rollout_mudur_onay_tarihi=NULL, pm_onay_tarihi=$14, pm_onaylayan=NULL, direktor_onay_tarihi=NULL, direktor_onaylayan=NULL, direktor_onay_kaynagi=NULL,
          muhasebe_onay_tarihi=NULL, odeme_tarihi=NULL, red_aciklama=NULL, reddeden_email=NULL, red_asama=NULL, red_zamani=NULL, reddeden_user_id=NULL,
          aktif_tur_no=$15, surum=COALESCE(surum,1)+1
        WHERE id=$1 AND durum='REDDEDILDI' AND COALESCE(aktif_tur_no,1)=$16 RETURNING *`,
        [id, yeni.tutar, yeni.tarih, yeni.gider_turu, yeni.bolge, yeni.proje, yeni.plaka, yeni.arac_km, yeni.aciklama, yeni.not_aciklama, yeni.son_odeme_tarihi, yeni.firma,
          yeniDurum, orhanMi ? bugun : null, yeniTur, oncekiTur]);
      if (!u.rows[0]) { await client.query("ROLLBACK"); return hata(res, 409, "Talep bu arada başka bir işlemle değişti; listeyi yenileyin"); }
      await client.query(`INSERT INTO is_avans_tur (talep_id, tur_no, gonderen_email, gonderen_user_id, gonderim_aciklama, alanlar, degisen, istek_anahtari) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, yeniTur, _e(req.user?.email) || null, _uid(req.user), aciklama, JSON.stringify(alanlar(u.rows[0])), JSON.stringify(degisen), istekAnahtari]);
      await client.query("COMMIT");
      let talep = u.rows[0];
      // Geçmiş: değişen alanların önceki / yeni değerleri + düzeltme açıklaması (önceki açıklama ve red gerekçesi tur kaydında durur)
      const eskiLog = { durum: "REDDEDILDI", tur_no: oncekiTur }, yeniLog = { durum: yeniDurum, tur_no: yeniTur };
      for (const [k, v] of Object.entries(degisen)) { eskiLog[k] = v.eski; yeniLog[k] = v.yeni; }
      await islemGecmisiYaz(req, "avans", id, "YENIDEN_GONDERIM", eskiLog, yeniLog, aciklama);
      // Teknocenter zinciri: atlanan aşamalar bekletilmez; Orhan'ın kendi talebi PM onayı olarak kimliğiyle işaretlenir
      try {
        if (tekno) {
          if (orhanMi && (await tekno.zincirKimlikleri("avans", [id])).size) await pool.query(`UPDATE is_avans_talep SET pm_onaylayan=$1, firma='TEKNO' WHERE id=$2`, [_e(req.user.email), id]);
          await tekno.normalize(req, "avans", id);
          talep = (await pool.query(`SELECT * FROM is_avans_talep WHERE id=$1`, [id])).rows[0] || talep;
        }
      } catch (e) { console.error("[avans-tur yönlendirme]", e.message); }
      const zincir = await zincirOzeti(req, id);
      await pool.query(`UPDATE is_avans_tur SET zincir=$3 WHERE talep_id=$1 AND tur_no=$2`, [id, yeniTur, JSON.stringify(zincir)]).catch(() => {});
      let rows = tekno ? await tekno.bilgiEkle(req, "avans", [talep]) : [talep];
      rows = await turBilgisiEkle(req, rows);
      res.json({ ok: true, tur_no: yeniTur, degisen, zincir, talep: rows[0] });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[avans yeniden-gonder]", e.message);
      if (!res.headersSent) hata(res, 500, e.message);
    } finally { client.release(); }
  });

  // ── Talep detayı: ana kayıt + turlar (gönderimler) + yetki. Olay akışı mevcut /islem-gecmisi/avans/:id ucundan. ──
  app.get("/hr/is-avans/:id/detay", authMiddleware, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return hata(res, 400, "Geçersiz talep");
      if (c.taseronMu(req.user)) return hata(res, 403, "Yetkiniz yok");
      const t = (await pool.query(`SELECT t.*, p.ad_soyad AS personel_ad, p.email AS personel_email, COALESCE(p.marka,'ERC') AS personel_marka, p.unvan AS personel_unvan
        FROM is_avans_talep t LEFT JOIN personel p ON p.id = t.personel_id WHERE t.id=$1`, [id])).rows[0];
      if (!t) return hata(res, 404, "Kayıt bulunamadı");
      const sahibi = await sahipMi(req.user, t);
      // Görme yetkisi: sahibi, tam görüş, onay zinciri üyesi; kapsam ve Orhan'ın kişisel kayıt gizliliği ayrıca
      let zincirOnaycisi = false;
      try { const tb = tekno ? await tekno.tekBilgi(req, "avans", id) : null; zincirOnaycisi = !!tb && (tb.bilgi.benim || c.avansOnayciMi(req.user, req)); } catch {}
      if (!(sahibi || c.avansTamGorus(req) || c.avansOnayciMi(req.user, req) || zincirOnaycisi)) return hata(res, 403, "Bu talebi görüntüleme yetkiniz yok");
      if (!c.avansKapsamda(c.altMarkaKapsam(req), t)) return hata(res, 403, "Bu talep firmanızın kapsamında değil");
      if (!sahibi && c.pmAvansSahibiMi(t) && !c.pmKisiselGorur(req)) return hata(res, 403, "Bu talebi görüntüleme yetkiniz yok");
      let rows = tekno ? await tekno.bilgiEkle(req, "avans", [t]) : [t];
      rows = await turBilgisiEkle(req, rows);
      const talep = rows[0];
      const tl = (await pool.query(`SELECT * FROM is_avans_tur WHERE talep_id=$1 ORDER BY tur_no`, [id])).rows;
      const emails = [...new Set(tl.flatMap((r) => [r.gonderen_email, r.reddeden_email]).filter(Boolean).map(_e))];
      const adMap = new Map(emails.length ? (await pool.query(`SELECT LOWER(TRIM(email)) AS email, name FROM users WHERE LOWER(TRIM(email)) = ANY($1)`, [emails])).rows.map((x) => [x.email, x.name]) : []);
      const ad = (e) => (e ? adMap.get(_e(e)) || e : null);
      const aktif = Number(t.aktif_tur_no || 1);
      const turlar = tl.map((r) => ({
        tur_no: Number(r.tur_no), aktif: Number(r.tur_no) === aktif, gonderim_zamani: r.gonderim_zamani, gonderen_email: r.gonderen_email, gonderen_ad: ad(r.gonderen_email),
        gonderim_aciklama: r.gonderim_aciklama || null, alanlar: r.alanlar || null, degisen: r.degisen || null, zincir: r.zincir || null,
        sonuc: r.sonuc || (Number(r.tur_no) === aktif ? (t.durum === "REDDEDILDI" ? "REDDEDILDI" : t.durum === "TAMAMLANDI" ? "ONAYLANDI" : "ACIK") : null), sonuc_zamani: r.sonuc_zamani,
        red: r.sonuc === "REDDEDILDI" || (Number(r.tur_no) === aktif && t.durum === "REDDEDILDI") ? {
          aciklama: r.red_aciklama || (Number(r.tur_no) === aktif ? t.red_aciklama : null) || null, reddeden_email: r.reddeden_email || (Number(r.tur_no) === aktif ? t.reddeden_email : null) || null,
          reddeden_ad: ad(r.reddeden_email || (Number(r.tur_no) === aktif ? t.reddeden_email : null)), zaman: r.sonuc_zamani || (Number(r.tur_no) === aktif ? t.red_zamani : null) || null,
          asama: r.red_asama || (Number(r.tur_no) === aktif ? t.red_asama : null) || null, asama_tr: r.red_asama_tr || asamaTr(r.red_asama || (Number(r.tur_no) === aktif ? t.red_asama : null), r.red_akis) } : null,
      }));
      // Eski kayıt: tur satırı yoksa 1. gönderim talep anından sentezlenir
      if (!turlar.length) turlar.push({ tur_no: 1, aktif: true, gonderim_zamani: t.created_at, gonderen_email: t.talep_eden_email, gonderen_ad: t.talep_eden_ad || null, gonderim_aciklama: null,
        alanlar: alanlar(t), degisen: null, zincir: null, sonuc: t.durum === "REDDEDILDI" ? "REDDEDILDI" : t.durum === "TAMAMLANDI" ? "ONAYLANDI" : "ACIK", sonuc_zamani: null,
        red: t.durum === "REDDEDILDI" ? talep.red : null, sentez: true });
      res.json({ ok: true, talep, turlar, alan_adlari: ALAN_TR, yetki: { sahibi, duzeltilebilir: sahibi && t.durum === "REDDEDILDI" } });
    } catch (e) { console.error("[avans detay]", e.message); hata(res, 500, e.message); }
  });

  return { turBilgisiEkle, reddiKaydet, turKontrol, turKapat, ilkTur, anahtarlaTalep, sahipMi, teknoBagla, asamaTr, alanlar, fark, DURUM_ASAMA, ESKI_KAYIT_NOTU };
}

module.exports = { semaKur, kur, alanlar, fark, asamaTr, ASAMA_TR_ERC, ASAMA_TR_TEKNO, DURUM_ASAMA, DUZENLENEBILIR, ALAN_TR, ESKI_KAYIT_NOTU };
