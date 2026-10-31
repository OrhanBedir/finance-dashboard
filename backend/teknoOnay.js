// Teknocenter iş avansı / masraf formu onay akışı (31.10.2026, Orhan şartnamesi)
//
// Teknocenter kendi personelinin iş avansını ve masraf ödemesini kendi hesabından yapar; talep ERC içinde açılır ve onay
// ERC içinde yürür. Bu modül YALNIZ "Teknocenter zincirindeki" kayıtları yönetir; Şimşek ve diğer firmaların akışı aynen kalır.
//
// Zincire giren kayıt (kapsam şirket / personel ilişkisinden; kullanıcı adı, serbest metin ya da saha kodu kullanılmaz):
//   iş avansı : talebin firması (onayDevri.avansFirmaSql: personel markası → talep edenin kullanıcı markası → kasa) = TEKNO
//               ve talep tarihi Teknocenter döneminde (markalar.devir_baslangic, 14.10.2026'dan itibaren)
//   masraf    : formun firması (onayDevri.masrafFirmaSql) = TEKNO ve formdaki tüm kalemler Teknocenter döneminde
//               (dönem öncesi kalemi olan form Şimşek dönemine aittir, eski akışta kalır)
//
// Aşamalar (sırayla; onaycısı olmayan ya da kendi talebine denk gelen aşama ATLANIR, bekleyen onay olarak kalmaz).
// 31.10.2026 Orhan kararı: ayrı bir "ilk yönetici / ekip şefi" aşaması YOK; zincir bölge müdürüyle başlar.
//   RM   bölge / rollout müdürü — personel kartındaki bölge (boşsa ekibin bölgesi): İzmir → Serdar Altınova,
//        Ankara / Bursa → Nurcan Kuş. İkisine ardışık gitmez. Bölge bulunamazsa aşama atlanır → talep Orhan'a düşer.
//   PM   Orhan Bedir
//   PD   Teknocenter direktörü (rol 'direktor' + firma TEKNO = İlhami Şahin; firmaya tarihli onay devri varsa devralan).
//        Teknocenter muhasebesi (rol 'firma_muhasebe' + firma TEKNO) bu aşamayı YALNIZ Orhan onayından geçmiş talepte
//        kendi kimliğiyle tamamlayabilir (vekâlet; işlem geçmişinde ve kayıtta ayrıca işaretlenir).
//   ODE  Teknocenter muhasebesi: iş avansında ödeme (onay ≠ ödendi), masrafta kontrol + arşiv
// Depo personeli ve Hatice Omuş'un kendi talepleri RM aşamasını atlar (doğrudan Orhan).
// Düzgün Şimşek, Erencan Şimşek, Şimşek muhasebesi ve ortak 'teknocenter' hesabı bu zincirde onaycı değildir.
//
// Durum alanı (durum) mevcut anlamıyla kalır = sıradaki aşamanın göstergesi:
//   iş avansı : TALEP (RM bekler) → ROLLOUT_MUDUR_ONAY (PM bekler) → PM_ONAY (PD bekler) → DIREKTOR_ONAY (ödeme) → TAMAMLANDI
//   masraf    : ROLLOUT_BEKLE (RM) → PM_BEKLE → DIREKTOR_BEKLE → TAMAMLANDI (muhasebe arşivi) → ARSIVLENDI
//   (Şimşek muhasebesinin MUHASEBE_BEKLE adımı Teknocenter zincirinde yoktur; o durumda bekleyen form PM aşamasındadır.)

const FIRMA = "TEKNO";
const ORHAN_EMAIL = ["orhan.bedir@simsektel.com", "orhan.bedir@gmail.com"];
// Bölge → bölge / rollout müdürü (31.10.2026 Orhan kararı; web Org şeması ORG_YONETIM ile aynı)
const BOLGE_MUDURU = { IZMIR: "serdar.altinova@simsektel.com", ANKARA: "nurcan.kus@simsektel.com", BURSA: "nurcan.kus@simsektel.com" };
// Doğrudan Orhan'a giden personel: personel.id + e-posta ÇİFTİ (canlı kayıttan 31.10.2026 salt-okunur doğrulandı)
const DOGRUDAN_PM = [
  { personel_id: 15, email: "hatice.omus@simsektel.com", neden: "Hatice Omuş" },
  { personel_id: 47, email: "emre.akdegirmen@simsektel.com", neden: "depo personeli (Envanter / Depo)" },
];
const ASAMALAR = ["RM", "PM", "PD", "ODE"];
const ASAMA_TR = {
  RM: "Bölge / rollout müdürü onayı", PM: "Orhan Bedir (PM) onayı",
  PD: "İlhami Şahin (Teknocenter direktörü) onayı", ODE_avans: "Ödeme — Teknocenter muhasebesi", ODE_masraf: "Kontrol ve arşiv — Teknocenter muhasebesi",
};
const VEKALET_NOTU = "İlhami onay aşaması muhasebe yetkisiyle tamamlandı";
const DURUM = {
  avans: { RM: "TALEP", PM: "ROLLOUT_MUDUR_ONAY", PD: "PM_ONAY", ODE: "DIREKTOR_ONAY", BITTI: "TAMAMLANDI" },
  masraf: { RM: "ROLLOUT_BEKLE", PM: "PM_BEKLE", PD: "DIREKTOR_BEKLE", ODE: "TAMAMLANDI", BITTI: "ARSIVLENDI" },
};
const ACIK_DURUM = { avans: ["TALEP", "ROLLOUT_MUDUR_ONAY", "PM_ONAY", "DIREKTOR_ONAY"], masraf: ["ROLLOUT_BEKLE", "MUHASEBE_BEKLE", "PM_BEKLE", "DIREKTOR_BEKLE", "TAMAMLANDI"] };

const _e = (v) => String(v || "").toLowerCase().trim();
const _rol = (u) => String(u?.role || "").toLowerCase();
const _uid = (u) => Number(u?.user_id || u?.id || 0) || null;
const bolgeKodu = (v) => String(v || "").trim().toLocaleUpperCase("tr-TR")
  .replace(/İ/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C").replace(/[^A-Z]/g, "");
const firmaMuhasebeMi = (u) => _rol(u) === "firma_muhasebe";

// Durum göstergesi → zincirdeki başlangıç aşaması (bu aşamadan itibaren ilk atlanmayan aşama beklemededir)
function gosterge(modul, r) {
  const d = String(r.durum || "");
  if (modul === "avans") return { TALEP: "RM", ROLLOUT_MUDUR_ONAY: "PM", PM_ONAY: "PD", DIREKTOR_ONAY: "ODE" }[d] || null;
  return { ROLLOUT_BEKLE: "RM", MUHASEBE_BEKLE: "PM", PM_BEKLE: "PM", DIREKTOR_BEKLE: "PD", TAMAMLANDI: "ODE" }[d] || null;
}

// Saf kural: bağlam satırından zinciri kurar. kisiler: { orhan:[u], rm:{email→u}, direktor:[u], muhasebe:[u], byId:{id→u} }
function zincirKur(b, kisiler, pdDevir) {
  const sahipEmail = new Set([_e(b.p_email), b.personel_id ? "" : _e(b.talep_eden_email)].filter(Boolean));
  const sahipUid = new Set([Number(b.p_uid) || 0].filter(Boolean));
  if (!b.personel_id) { const tu = Object.values(kisiler.byEmail || {}).find((u) => u.email === _e(b.talep_eden_email)); if (tu) sahipUid.add(tu.id); }
  const sahipMi = (u) => !!u && (sahipUid.has(Number(u.id)) || sahipEmail.has(u.email));
  const dogrudan = DOGRUDAN_PM.find((d) => (b.personel_id ? Number(b.personel_id) === d.personel_id && _e(b.p_email) === d.email : _e(b.talep_eden_email) === d.email));
  const z = [];
  const ekle = (k, onaycilar, atla) => z.push({ k, onaycilar: atla ? [] : onaycilar, atlandi: atla || (onaycilar.length ? null : "onaycı tanımlı değil") });
  const bolge = bolgeKodu(b.p_bolge) || bolgeKodu(b.e_bolge);
  const rmUser = BOLGE_MUDURU[bolge] ? kisiler.byEmail[BOLGE_MUDURU[bolge]] : null;
  if (dogrudan) ekle("RM", [], `${dogrudan.neden}: doğrudan Orhan`);
  else if (!rmUser) ekle("RM", [], bolge ? `${bolge} için bölge müdürü tanımlı değil — doğrudan Orhan` : "personel kartında ve ekibinde bölge yok — doğrudan Orhan");
  else if (sahipMi(rmUser)) ekle("RM", [], "bölge müdürünün kendi talebi");
  else ekle("RM", [rmUser]);
  const orhan = kisiler.orhan.filter((u) => !sahipMi(u));
  ekle("PM", orhan, kisiler.orhan.some(sahipMi) ? "Orhan Bedir'in kendi talebi" : null);
  if (pdDevir?.hata) z.push({ k: "PD", onaycilar: [], atlandi: null, kilit: pdDevir.hata });
  else {
    const dir = pdDevir?.devir ? [kisiler.byId[Number(pdDevir.devir.onayci_user_id)]].filter(Boolean) : kisiler.direktor;
    if (dir.length && dir.every(sahipMi)) ekle("PD", [], "direktörün kendi talebi");
    else z.push({ k: "PD", onaycilar: dir.filter((u) => !sahipMi(u)), atlandi: null, kilit: dir.length ? null : "Teknocenter direktörü (rol direktör, firma TEKNO) tanımlı değil" });
  }
  // Ödeme / arşiv aşaması hiçbir zaman atlanmaz; muhasebe hesabı yoksa ödeme bekler (kilit bilgisiyle)
  z.push({ k: "ODE", onaycilar: kisiler.muhasebe.filter((u) => !sahipMi(u)), atlandi: null,
    kilit: kisiler.muhasebe.length ? null : "Teknocenter muhasebe hesabı (rol firma_muhasebe, firma TEKNO) henüz atanmadı" });
  return z;
}

// Aynı kişinin iki hesabı (ör. Orhan Bedir simsektel + platform) ekranda tek ad olarak gösterilir
const tekAd = (liste) => { const g = new Set(); return liste.filter((x) => { const k = String(x.ad || "").replace(/\s*\(.*\)\s*$/, "").toLocaleUpperCase("tr-TR"); if (g.has(k)) return false; g.add(k); return true; }); };
// Zincirde, verilen aşamadan (dahil) itibaren ilk atlanmayan aşama
const ilkAcik = (z, k) => { const i = ASAMALAR.indexOf(k); for (const s of z) if (ASAMALAR.indexOf(s.k) >= i && !s.atlandi) return s; return null; };
const sonrakiAcik = (z, k) => { const i = ASAMALAR.indexOf(k); for (const s of z) if (ASAMALAR.indexOf(s.k) > i && !s.atlandi) return s; return null; };

// Ek sütunlar (yalnız ekleme; mevcut veri değişmez). Aynısı migrations/2026-10-31_tekno_onay_akisi.sql dosyasında.
async function semaKur(pool) {
  const q = (x) => pool.query(x).catch((e) => console.error("[tekno-onay şema]", e.message));
  await q(`ALTER TABLE is_avans_talep ADD COLUMN IF NOT EXISTS pm_onaylayan TEXT,
    ADD COLUMN IF NOT EXISTS direktor_onaylayan TEXT, ADD COLUMN IF NOT EXISTS direktor_onay_kaynagi TEXT`);
  await q(`ALTER TABLE masraf_form ADD COLUMN IF NOT EXISTS pm_onaylayan TEXT,
    ADD COLUMN IF NOT EXISTS direktor_onaylayan TEXT, ADD COLUMN IF NOT EXISTS direktor_onay_kaynagi TEXT`);
}

function kur(app, c) {
  const { pool, authMiddleware, islemGecmisiYaz } = c;
  const hata = (res, kod, mesaj, ek) => res.status(kod).json({ ok: false, error: mesaj, ...(ek || {}) });
  const devir = () => c.markaProfil(FIRMA).devir; // TR günü, YYYY-MM-DD
  const bugun = () => c.istanbulBugun();

  // ── Kişiler (kısa önbellek): Orhan, bölge müdürleri, Teknocenter direktörü / muhasebesi ──
  let _k = { t: 0, v: null };
  async function kisiler(ekIdler = []) {
    if (!_k.v || Date.now() - _k.t > 10000) {
      const r = await pool.query(`SELECT id, LOWER(TRIM(email)) AS email, name, LOWER(COALESCE(role,'')) AS role, UPPER(COALESCE(marka,'ERC')) AS marka
        FROM users WHERE COALESCE(is_active,true) AND COALESCE(status,'active') = 'active' AND COALESCE(role,'') <> 'subcon'
          AND (LOWER(TRIM(email)) = ANY($1) OR (UPPER(COALESCE(marka,'')) = $2 AND LOWER(COALESCE(role,'')) IN ('direktor','firma_muhasebe')))
        ORDER BY id`, [[...ORHAN_EMAIL, ...Object.values(BOLGE_MUDURU), ...DOGRUDAN_PM.map((d) => d.email)], FIRMA]);
      _k = { t: Date.now(), v: r.rows };
    }
    let rows = _k.v;
    const eksik = ekIdler.map(Number).filter((id) => id && !rows.some((u) => u.id === id));
    if (eksik.length) {
      const r = await pool.query(`SELECT id, LOWER(TRIM(email)) AS email, name, LOWER(COALESCE(role,'')) AS role, UPPER(COALESCE(marka,'ERC')) AS marka
        FROM users WHERE id = ANY($1) AND COALESCE(is_active,true) AND COALESCE(status,'active') = 'active' AND COALESCE(role,'') <> 'subcon'`, [eksik]);
      rows = [...rows, ...r.rows];
    }
    const byId = {}, byEmail = {};
    for (const u of rows) { byId[u.id] = u; if (!byEmail[u.email]) byEmail[u.email] = u; }
    return {
      byId, byEmail,
      orhan: rows.filter((u) => ORHAN_EMAIL.includes(u.email)),
      // Teknocenter direktörü / muhasebesi: rol + firma (kullanıcı adına bağlı değil)
      direktor: rows.filter((u) => u.role === "direktor" && u.marka === FIRMA),
      muhasebe: rows.filter((u) => u.role === "firma_muhasebe" && u.marka === FIRMA),
    };
  }

  // ── Bağlam sorguları (toplu): zincir için gereken personel / ekip bölgesi + dönem + Orhan PM onayı ──
  const BAGLAM_SQL = {
    avans: (ids) => [`SELECT t.id, t.durum, t.tarih, t.tutar, t.firma, t.personel_id, t.talep_eden_email, t.talep_eden_ad,
        t.pm_onay_tarihi, t.pm_onaylayan, t.direktor_onay_kaynagi, t.direktor_onaylayan,
        ${c.avansFirmaSql("t", "p")} AS akis_firma, p.ad_soyad AS personel_ad,
        LOWER(TRIM(COALESCE(p.email,''))) AS p_email, p.user_id AS p_uid, p.bolge AS p_bolge, e.bolge AS e_bolge,
        (t.tarih >= DATE '${devir()}') AS donem_ok,
        (LOWER(TRIM(COALESCE(t.pm_onaylayan,''))) = ANY($2) OR EXISTS (SELECT 1 FROM islem_gecmisi g WHERE g.modul='avans' AND g.kayit_id=t.id AND g.tip='ONAY'
           AND g.yeni->>'durum' IN ('PM_ONAY','DIREKTOR_ONAY') AND LOWER(TRIM(COALESCE(g.kullanici,''))) = ANY($2))) AS pm_orhan
      FROM is_avans_talep t LEFT JOIN personel p ON p.id = t.personel_id
      LEFT JOIN ekipler e ON e.ekip_no::text = NULLIF(TRIM(p.ekip_bilgisi),'') AND COALESCE(e.aktif,true)
      WHERE t.id = ANY($1)`, [ids, ORHAN_EMAIL]],
    // Masraf PM adımını yalnız Orhan onaylar (MASRAF_PM_MAIL) → pm_onay_tarihi doluysa Orhan onayı vardır
    masraf: (ids) => [`SELECT mf.id, mf.durum, mf.form_no, mf.donem, mf.personel_id AS mf_personel_id, mf.talep_eden_email, mf.talep_eden_ad,
        mf.pm_onay_tarihi, mf.pm_onaylayan, mf.direktor_onay_kaynagi, mf.direktor_onaylayan,
        ${c.masrafFirmaSql("mf", "p")} AS akis_firma, p.id AS personel_id, p.ad_soyad AS personel_ad,
        LOWER(TRIM(COALESCE(p.email,''))) AS p_email, p.user_id AS p_uid, p.bolge AS p_bolge, e.bolge AS e_bolge,
        NOT EXISTS (SELECT 1 FROM masraf_kalem mk WHERE mk.form_id = mf.id AND (mk.tarih IS NULL OR mk.tarih < DATE '${devir()}')) AS donem_ok,
        (mf.pm_onay_tarihi IS NOT NULL) AS pm_orhan,
        COALESCE((SELECT SUM(mk.tutar) FROM masraf_kalem mk WHERE mk.form_id = mf.id),0) AS tutar
      FROM masraf_form mf
      LEFT JOIN LATERAL (SELECT pp.* FROM personel pp WHERE pp.id = mf.personel_id
          OR (mf.personel_id IS NULL AND LOWER(TRIM(COALESCE(pp.email,''))) = LOWER(TRIM(COALESCE(mf.talep_eden_email,''))) AND pp.aktif)
        ORDER BY (pp.id = mf.personel_id) DESC, pp.id DESC LIMIT 1) p ON true
      LEFT JOIN ekipler e ON e.ekip_no::text = NULLIF(TRIM(p.ekip_bilgisi),'') AND COALESCE(e.aktif,true)
      WHERE mf.id = ANY($1)`, [ids]],
  };
  const zincirde = (b) => String(b.akis_firma || "").toUpperCase() === FIRMA && b.donem_ok === true;

  // Oturumdaki kullanıcı bir onaycı listesinde mi (kimlik ya da e-posta)
  const benMi = (req, liste) => { const id = _uid(req.user), e = _e(req.user?.email); return (liste || []).some((u) => (id && u.id === id) || (e && u.email === e)); };
  const muhasebeYetkisi = (req) => firmaMuhasebeMi(req.user) && String(req.user?.marka || "").toUpperCase() === FIRMA && !!c.altMarkaKapsam(req);

  // Bir kaydın zincir bilgisi (ekran / sayaç / onay kararı aynı fonksiyondan)
  function bilgiKur(req, modul, b, kis, pdDevir) {
    const z = zincirKur(b, kis, pdDevir);
    const gost = gosterge(modul, b);
    let asama = gost ? ilkAcik(z, gost) : null;
    // PD aşaması Orhan onayı olmadan açılmaz: PM aşaması atlanmamışsa ve Orhan onayı kayıtlı değilse aşama PM'dir
    const pmAsama = z.find((s) => s.k === "PM");
    if (asama && asama.k === "PD" && !pmAsama.atlandi && !b.pm_orhan) asama = pmAsama;
    const k = asama?.k || null;
    const onayci = !!asama && !asama.kilit && benMi(req, asama.onaycilar);
    // Vekâlet: Teknocenter muhasebesi, PD aşamasında ve yalnız Orhan onayından geçmiş talepte
    const vekalet = k === "PD" && !onayci && muhasebeYetkisi(req) && b.pm_orhan === true && !asama.kilit;
    const ode = k === "ODE" && muhasebeYetkisi(req) && !asama.kilit && benMi(req, asama.onaycilar);
    const benim = (k && k !== "ODE" && (onayci || vekalet)) || ode;
    const sira = gost ? ASAMALAR.indexOf(k || gost) : 99;
    return {
      akis: "TEKNO", asama: k, asama_tr: k ? (k === "ODE" ? ASAMA_TR[`ODE_${modul}`] : ASAMA_TR[k]) : null,
      onaycilar: tekAd((asama?.onaycilar || []).map((u) => ({ id: u.id, ad: u.name || u.email }))),
      kilit: asama?.kilit || null, benim, vekalet, odeme: ode, orhan_onayi: !!b.pm_orhan,
      direktor_onay_kaynagi: b.direktor_onay_kaynagi || null,
      zincir: z.map((s) => ({ k: s.k, ad: s.k === "ODE" ? ASAMA_TR[`ODE_${modul}`] : ASAMA_TR[s.k],
        kisiler: tekAd(s.onaycilar.map((u) => ({ ad: u.name || u.email }))).map((x) => x.ad), atlandi: s.atlandi || null,
        durum: s.atlandi ? "atlandi" : !gost ? (["TAMAMLANDI", "ARSIVLENDI"].includes(b.durum) ? "tamam" : "-") : s.k === k ? "bekliyor" : ASAMALAR.indexOf(s.k) < sira ? "tamam" : "sirada" })),
    };
  }

  // Toplu: satır kimlikleri → { id → bağlam } (yalnız Teknocenter zincirindekiler)
  async function baglamlar(modul, ids) {
    const temiz = [...new Set((ids || []).map(Number).filter(Boolean))];
    if (!temiz.length) return new Map();
    const [sql, p] = BAGLAM_SQL[modul](temiz);
    const r = await pool.query(sql, p);
    return new Map(r.rows.filter(zincirde).map((b) => [Number(b.id), b]));
  }
  async function pdDevirOku(modul) {
    return c.onayPanel.adimOnaycisi(FIRMA, modul === "avans" ? "AVANS_PD" : "MASRAF_PD").catch(() => ({ devir: null, hata: null }));
  }
  // Satırlara zincir bilgisi ekler (tekno alanı); zincir dışı satırlar dokunulmadan döner
  async function bilgiEkle(req, modul, rows) {
    if (!Array.isArray(rows) || !rows.length) return rows;
    // Yalnız açık (onay / ödeme bekleyen) satırlar; kapanmış kayıtta zincir hesaplanmaz (durumu sütunlarında kayıtlı)
    const bag = await baglamlar(modul, rows.filter((x) => x.durum === undefined || ACIK_DURUM[modul].includes(x.durum)).map((x) => x.id));
    if (!bag.size) return rows;
    const kis = await kisiler();
    const pd = await pdDevirOku(modul);
    return rows.map((x) => { const b = bag.get(Number(x.id)); return b ? { ...x, tekno: bilgiKur(req, modul, b, kis, pd) } : x; });
  }
  async function tekBilgi(req, modul, id) {
    const bag = await baglamlar(modul, [id]);
    const b = bag.get(Number(id));
    if (!b) return null;
    const kis = await kisiler();
    return { b, kis, bilgi: bilgiKur(req, modul, b, kis, await pdDevirOku(modul)) };
  }

  // Bekleyen onaylar (mobil Onaylar, ana sayfa sayacı, /onay/bekleyen): oturumdaki kişinin ŞU AN işlem yapabileceği
  // Teknocenter zinciri kayıtları. Ödeme aşaması onay sayacına girmez (mevcut kural: ödeme ayrı iş).
  async function bekleyenler(req, modul) {
    const durumlar = ACIK_DURUM[modul];
    const r = modul === "avans"
      ? await pool.query(`SELECT t.id FROM is_avans_talep t WHERE t.durum = ANY($1) AND t.tarih >= DATE '${devir()}' ORDER BY t.created_at ASC LIMIT 300`, [durumlar])
      : await pool.query(`SELECT mf.id FROM masraf_form mf WHERE mf.durum = ANY($1) ORDER BY mf.created_at ASC LIMIT 300`, [durumlar]);
    const satirlar = await bilgiEkle(req, modul, r.rows);
    return satirlar.filter((x) => x.tekno && x.tekno.benim && x.tekno.asama !== "ODE").map((x) => ({ id: x.id, tekno: x.tekno }));
  }
  const zincirKimlikleri = async (modul, ids) => new Set((await baglamlar(modul, ids)).keys());

  // ── Durum düzeltme: oluşturma / onaya gönderme sonrası durum göstergesini ilk açık aşamaya getirir (atlanan aşama beklemez) ──
  async function normalize(req, modul, id) {
    const t = await tekBilgi(req, modul, id);
    if (!t || !t.bilgi.asama) return null;
    const hedef = DURUM[modul][t.bilgi.asama];
    if (hedef === t.b.durum) return null;
    // yalnız ileri götürür (ör. TALEP → ROLLOUT_MUDUR_ONAY); geri almaz
    const sira = (d) => ASAMALAR.indexOf(gosterge(modul, { durum: d }));
    if (sira(hedef) <= sira(t.b.durum)) return null;
    const tablo = modul === "avans" ? "is_avans_talep" : "masraf_form";
    const u = await pool.query(`UPDATE ${tablo} SET durum=$1 WHERE id=$2 AND durum=$3 RETURNING id`, [hedef, id, t.b.durum]);
    if (u.rows[0]) await islemGecmisiYaz(req, modul, id, "YONLENDIRME", { durum: t.b.durum }, { durum: hedef, akis: "TEKNO",
      atlanan: t.bilgi.zincir.filter((s) => s.atlandi && ASAMALAR.indexOf(s.k) < ASAMALAR.indexOf(t.bilgi.asama)).map((s) => `${s.k}: ${s.atlandi}`).join("; ") || null }, "Teknocenter onay zinciri: atlanan aşamalar bekletilmez");
    return hedef;
  }

  // ── Onay: mevcut aşamayı oturumdaki kişinin kimliğiyle tamamlar ──
  // izinli: bu uçtan yapılabilecek aşamalar (null = hepsi). Yanıt verildiyse true döner.
  async function onayla(req, res, modul, id, izinli) {
    const t = await tekBilgi(req, modul, id);
    if (!t) return false; // zincir dışı: eski akış
    const { b, bilgi } = t;
    const beklenen = req.body?.beklenen_durum;
    if (beklenen && String(beklenen) !== String(b.durum)) { hata(res, 409, "Talep bu arada başka bir onaycı tarafından ilerletildi; güncel aşama ekranda gösteriliyor.", { guncel_durum: b.durum }); return true; }
    const k = bilgi.asama;
    if (!k) { hata(res, 409, "Bu kayıt onay aşamasında değil (zaten işlenmiş olabilir)."); return true; }
    if (izinli && !izinli.includes(k)) { hata(res, 403, `Bu kayıt şu an "${bilgi.asama_tr}" aşamasında; bu uçtan yapılamaz.`); return true; }
    if (bilgi.kilit) { hata(res, 423, bilgi.kilit); return true; }
    if (!bilgi.benim) {
      const kim = bilgi.onaycilar.map((x) => x.ad).join(", ") || "tanımlı onaycı yok";
      hata(res, 403, k === "PD" && muhasebeYetkisi(req) && !b.pm_orhan ? "Orhan Bedir onayı olmadan İlhami aşaması muhasebe yetkisiyle tamamlanamaz"
        : `Bu aşama (${bilgi.asama_tr}) sizde değil — onaycı: ${kim}`);
      return true;
    }
    if (k === "ODE" && modul === "masraf") { hata(res, 400, "Masraf formu muhasebe aşamasında: kontrol sonrası 'Arşivle' kullanılır"); return true; }
    const z = zincirKur(b, t.kis, await pdDevirOku(modul));
    const sonraki = sonrakiAcik(z, k);
    const gun = bugun();
    const ben = _e(req.user?.email);
    const set = [], p = [];
    const ekle = (sql, v) => { p.push(v); set.push(sql.replace("?", `$${p.length}`)); };
    let yeniDurum;
    if (k === "ODE") { // iş avansı ödemesi
      yeniDurum = "TAMAMLANDI";
      const od = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.odeme_tarihi || "")) ? String(req.body.odeme_tarihi) : gun;
      if (od > gun) { hata(res, 400, "Ödeme tarihi ileri bir gün olamaz"); return true; }
      ekle("muhasebe_onay_tarihi=?", gun); ekle("odeme_tarihi=?", od);
      ekle("firma=?", FIRMA); // ödeme kaynağı Teknocenter (Şimşek nakit akışına düşmez)
    } else {
      yeniDurum = DURUM[modul][sonraki ? sonraki.k : "ODE"];
      if (k === "RM") ekle(modul === "avans" ? "rollout_mudur_onay_tarihi=?" : "rollout_onay_tarihi=?", gun);
      if (k === "PM") { ekle("pm_onay_tarihi=?", gun); ekle("pm_onaylayan=?", ben); }
      if (k === "PD") { ekle("direktor_onay_tarihi=?", gun); ekle("direktor_onaylayan=?", ben); ekle("direktor_onay_kaynagi=?", bilgi.vekalet ? "MUHASEBE_VEKALET" : "DIREKTOR"); }
      // PM onayıyla birlikte ödeme kaynağı Teknocenter'a kilitlenir (istemcinin seçtiği kasa kullanılmaz)
      if (modul === "avans" && ASAMALAR.indexOf(k) >= ASAMALAR.indexOf("PM")) ekle("firma=?", FIRMA);
    }
    const notAlan = modul === "masraf" ? ({ RM: "rollout_not", PM: "pm_not", PD: "direktor_not" })[k] : null;
    const not = String((notAlan && req.body?.[notAlan]) ?? req.body?.not ?? "").trim() || null;
    if (notAlan && not) ekle(`${notAlan}=?`, not);
    ekle("durum=?", yeniDurum);
    p.push(id, b.durum);
    const tablo = modul === "avans" ? "is_avans_talep" : "masraf_form";
    const u = await pool.query(`UPDATE ${tablo} SET ${set.join(", ")} WHERE id=$${p.length - 1} AND durum=$${p.length} RETURNING *`, p);
    const yeni = u.rows[0];
    if (!yeni) { hata(res, 409, "Bu kayıt az önce başka bir onaycı tarafından işlendi. Liste yenilendi."); return true; }
    // Ödeme: personelin iş avansı hareketi (avans tablosu, 'IS') yalnız bu güncelleme başarılıysa ve bir kez yazılır
    if (k === "ODE" && b.personel_id) {
      await pool.query(`INSERT INTO avans (personel_id,tarih,tutar,aciklama,avans_turu,odendi,odeme_tarihi) VALUES ($1,$2,$3,$4,'IS',true,$5)`,
        [b.personel_id, b.tarih, b.tutar, (await pool.query(`SELECT aciklama FROM is_avans_talep WHERE id=$1`, [id])).rows[0]?.aciklama || "İş Avansı", yeni.odeme_tarihi]);
    }
    if (modul === "masraf" && yeniDurum === "TAMAMLANDI") await c.masrafCezaAvansOlustur(id);
    const atlanan = z.filter((s) => s.atlandi && ASAMALAR.indexOf(s.k) > ASAMALAR.indexOf(k) && (!sonraki || ASAMALAR.indexOf(s.k) < ASAMALAR.indexOf(sonraki.k)))
      .map((s) => `${s.k}: ${s.atlandi}`).join("; ") || null;
    await islemGecmisiYaz(req, modul, id, k === "ODE" ? "ODEME" : "ONAY", { durum: b.durum, firma: b.firma || null },
      { durum: yeniDurum, adim: { RM: "ROLLOUT", PM: "PM", PD: "DIREKTOR", ODE: "ODEME" }[k], akis: "TEKNO",
        onay_kaynagi: k === "PD" ? (bilgi.vekalet ? "muhasebe_vekalet" : "direktor") : undefined, atlanan, ...(k === "ODE" ? { firma: FIRMA } : {}) },
      k === "PD" && bilgi.vekalet ? `${VEKALET_NOTU} (${ben})` : (k === "ODE" ? (String(req.body?.odeme_notu || "").trim() || null) : not));
    res.json(yeni);
    return true;
  }

  // ── Red / geri gönderme: aşamanın onaycısı, Orhan (ödeme öncesi her aşama) ya da ödeme aşamasında muhasebe ──
  async function redYetkisi(req, t) {
    const { bilgi } = t;
    if (!bilgi.asama) return "Bu kayıt onay aşamasında değil";
    const asama = bilgi.zincir.find((s) => s.k === bilgi.asama);
    const onayci = bilgi.benim && !bilgi.vekalet; // vekâlet yalnız onay içindir; reddi İlhami ya da Orhan verir
    const orhan = ORHAN_EMAIL.includes(_e(req.user?.email)) && bilgi.asama !== "ODE";
    if (onayci || orhan) return null;
    return `Bu aşamada (${asama?.ad || bilgi.asama}) reddetme / iade yetkiniz yok`;
  }
  async function avansReddet(req, res, id) {
    const t = await tekBilgi(req, "avans", id);
    if (!t) return false;
    const r = await redYetkisi(req, t);
    if (r) { hata(res, 403, r); return true; }
    const u = await pool.query(`UPDATE is_avans_talep SET durum='REDDEDILDI', red_aciklama=$1, reddeden_email=$2 WHERE id=$3 AND durum=$4 RETURNING *`,
      [req.body?.red_aciklama || null, _e(req.user?.email), id, t.b.durum]);
    if (!u.rows[0]) { hata(res, 409, "Bu kayıt az önce başka bir onaycı tarafından işlendi. Liste yenilendi."); return true; }
    await islemGecmisiYaz(req, "avans", id, "RED", { durum: t.b.durum }, { durum: "REDDEDILDI", adim: t.bilgi.asama, akis: "TEKNO" }, req.body?.red_aciklama || null);
    res.json(u.rows[0]);
    return true;
  }
  async function masrafReddet(req, res, id, iade) {
    const t = await tekBilgi(req, "masraf", id);
    if (!t) return false;
    if (t.bilgi.asama === "ODE" || !t.bilgi.asama) { hata(res, 409, "Form onay aşamasında değil — yalnız onay bekleyen formlar reddedilir / iade edilir"); return true; }
    const r = await redYetkisi(req, t);
    if (r) { hata(res, 403, r); return true; }
    const ack = String((iade ? req.body?.aciklama : req.body?.red_aciklama) || "").trim();
    if (iade && !ack) { hata(res, 400, "İade açıklaması zorunlu — personel neyi düzelteceğini bilmeli"); return true; }
    const u = iade
      ? await pool.query(`UPDATE masraf_form SET durum='TASLAK', red_aciklama=$1, reddeden_email=$2,
            pm_not=NULL, pm_onay_tarihi=NULL, pm_onaylayan=NULL, direktor_not=NULL, direktor_onay_tarihi=NULL, direktor_onaylayan=NULL, direktor_onay_kaynagi=NULL,
            rollout_not=NULL, rollout_onay_tarihi=NULL, muhasebe_onay_tarihi=NULL
          WHERE id=$3 AND durum=$4 RETURNING *`, [`↩ GERİ GÖNDERİLDİ: ${ack}`, _e(req.user?.email), id, t.b.durum])
      : await pool.query(`UPDATE masraf_form SET durum='REDDEDILDI', red_aciklama=$1, reddeden_email=$2 WHERE id=$3 AND durum=$4 RETURNING *`,
          [ack || null, _e(req.user?.email), id, t.b.durum]);
    if (!u.rows[0]) { hata(res, 409, "Form az önce başka bir onaycı tarafından işlendi. Liste yenilendi."); return true; }
    await islemGecmisiYaz(req, "masraf", id, iade ? "GERI_GONDER" : "RED", { durum: t.b.durum }, { durum: iade ? "TASLAK" : "REDDEDILDI", adim: t.bilgi.asama, akis: "TEKNO" }, ack || null);
    res.json(u.rows[0]);
    return true;
  }

  // ── Uçlar: Teknocenter zincirindeki kayıt ise burada işlenir, değilse mevcut uca geçer (next) ──
  // Bu kayıtlar mevcut uçlardan ÖNCE kaydedilir; eski e-posta listeleri (Düzgün, Şimşek muhasebesi, ortak hesap) zincire giremez.
  const sar = (fn) => (req, res, next) => authMiddleware(req, res, async () => {
    try {
      if (_rol(req.user) === "subcon") return hata(res, 403, "Taşeron hesabı bu işlemi yapamaz");
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return next();
      if (!(await fn(req, res, id))) return next();
    } catch (e) { console.error("[tekno-onay]", e.message); if (!res.headersSent) hata(res, 500, e.message); }
  });
  app.put("/hr/is-avans/:id/onayla", sar((req, res, id) => onayla(req, res, "avans", id, req.body?.tek_asama === true ? ["RM", "PM", "PD"] : null)));
  app.put("/hr/is-avans/:id/pm-onayla", sar((req, res, id) => onayla(req, res, "avans", id, ["PM"])));
  app.put("/hr/is-avans/:id/direktor-onayla", sar((req, res, id) => onayla(req, res, "avans", id, ["PD"])));
  app.put("/hr/is-avans/:id/reddet", sar((req, res, id) => avansReddet(req, res, id)));
  // Tutar düzeltme: Teknocenter zincirinde yalnız Orhan (PM) ve kendi aşamasında Teknocenter direktörü; ödenmiş / reddedilmiş talep değişmez
  app.put("/hr/is-avans/:id/duzenle", sar(async (req, res, id) => {
    const t = await tekBilgi(req, "avans", id);
    if (!t) return false;
    const orhan = ORHAN_EMAIL.includes(_e(req.user?.email));
    const dir = t.bilgi.asama === "PD" && t.bilgi.benim && !t.bilgi.vekalet;
    if (!t.bilgi.asama || t.bilgi.asama === "ODE") { hata(res, 409, "Onayı tamamlanmış / ödenmiş talebin tutarı değiştirilemez"); return true; }
    if (!orhan && !dir) { hata(res, 403, "Teknocenter talebinin tutarını yalnız Orhan Bedir ya da kendi aşamasında Teknocenter direktörü düzeltebilir"); return true; }
    const tutar = Number(String(req.body?.tutar ?? "").replace(",", "."));
    if (!(tutar > 0)) { hata(res, 400, "Geçerli tutar giriniz"); return true; }
    const u = await pool.query(`UPDATE is_avans_talep SET tutar=$1 WHERE id=$2 AND durum=$3 RETURNING *`, [tutar, id, t.b.durum]);
    if (!u.rows[0]) { hata(res, 409, "Talep bu arada işlendi"); return true; }
    await islemGecmisiYaz(req, "avans", id, "DUZENLEME", { tutar: t.b.tutar }, { tutar: u.rows[0].tutar }, req.body?.gerekce || null);
    res.json(u.rows[0]);
    return true;
  }));
  // Masraf: tek uç (sunucu aşamayı kendisi bulur) + mevcut aşama uçları
  app.put("/hr/masraf-form/:id/onayla", sar(async (req, res, id) => {
    if (await onayla(req, res, "masraf", id, null)) return true;
    hata(res, 400, "Bu form Teknocenter onay zincirinde değil; mevcut aşama uçları kullanılır"); return true;
  }));
  app.put("/hr/masraf-form/:id/rollout-onayla", sar((req, res, id) => onayla(req, res, "masraf", id, ["RM"])));
  app.put("/hr/masraf-form/:id/muhasebe-onayla", sar(async (req, res, id) => {
    if (!(await zincirKimlikleri("masraf", [id])).has(id)) return false;
    hata(res, 409, "Teknocenter masraf zincirinde ara muhasebe adımı yok; form sırasıyla Orhan Bedir ve İlhami Şahin onayından sonra Teknocenter muhasebesine gelir"); return true;
  }));
  app.put("/hr/masraf-form/:id/pm-onayla", sar((req, res, id) => onayla(req, res, "masraf", id, ["PM"])));
  app.put("/hr/masraf-form/:id/direktor-onayla", sar((req, res, id) => onayla(req, res, "masraf", id, ["PD"])));
  app.put("/hr/masraf-form/:id/pm-reddet", sar((req, res, id) => masrafReddet(req, res, id, false)));
  app.put("/hr/masraf-form/:id/direktor-reddet", sar((req, res, id) => masrafReddet(req, res, id, false)));
  app.put("/hr/masraf-form/:id/geri-gonder", sar((req, res, id) => masrafReddet(req, res, id, true)));
  // Arşiv (muhasebe kontrolü sonrası): Teknocenter zincirinde yalnız Teknocenter muhasebesi
  app.put("/hr/masraf-form/:id/arsivle", sar(async (req, res, id) => {
    const t = await tekBilgi(req, "masraf", id);
    if (!t) return false;
    if (t.b.durum !== "TAMAMLANDI") { hata(res, 409, "Form onayı tamamlanmadan arşivlenemez"); return true; }
    if (!t.bilgi.odeme) { hata(res, 403, t.bilgi.kilit || "Teknocenter masraf formunu yalnız Teknocenter muhasebesi arşivler"); return true; }
    const u = await pool.query(`UPDATE masraf_form SET durum='ARSIVLENDI', arsiv_tarihi=NOW() WHERE id=$1 AND durum='TAMAMLANDI' RETURNING *`, [id]);
    if (!u.rows[0]) { hata(res, 409, "Form az önce işlendi"); return true; }
    await islemGecmisiYaz(req, "masraf", id, "ARSIV", { durum: "TAMAMLANDI" }, { durum: "ARSIVLENDI", akis: "TEKNO" }, null);
    res.json(u.rows[0]);
    return true;
  }));
  // Zincir görünümü (web / mobil detay): yalnız kaydı görebilen kullanıcıya (kapsam kapısı ayrıca uygular)
  app.get("/tekno-onay/:modul/:id", authMiddleware, async (req, res) => {
    try {
      const modul = req.params.modul === "masraf" ? "masraf" : req.params.modul === "avans" ? "avans" : null;
      if (!modul) return hata(res, 400, "Geçersiz modül");
      const t = await tekBilgi(req, modul, Number(req.params.id));
      res.json({ ok: true, zincirde: !!t, ...(t ? { tekno: t.bilgi } : {}) });
    } catch (e) { hata(res, 500, e.message); }
  });

  return { bilgiEkle, bekleyenler, normalize, zincirKimlikleri, tekBilgi, FIRMA, VEKALET_NOTU };
}

// ═══ FİRMA KAPSAM KAPISI (31.10.2026): alt marka (Teknocenter / AHY) kullanıcısı kayıt kimliği ya da sorgu parametresiyle
// başka firmanın avans / masraf / ödeme kaydına, fişine, işlem geçmişine ve bakiyesine ULAŞAMAZ. Liste uçları zaten
// kapsamla süzülür; bu kapı kimlikli uçları (detay, onay, red, düzenleme, silme, belge indirme, geçmiş) ve sorguyla seçilen
// kişiyi kapatır. İstemcinin gönderdiği firma / personel bilgisine güvenilmez: ödeme kaydında firma oturumdan yazılır.
function kapsamKapisi(c) {
  const { pool } = c;
  const red = (res, m) => res.status(403).json({ ok: false, error: m || "Bu kayıt firmanızın kapsamında değil" });
  const bordroSql = (k) => `ANY('{${k.bordro.join(",")}}'::text[])`;
  async function avansKapsamda(k, id) {
    const r = (await pool.query(`SELECT t.tarih, t.firma, COALESCE(p.marka,'ERC') AS personel_marka FROM is_avans_talep t LEFT JOIN personel p ON p.id = t.personel_id WHERE t.id=$1`, [id])).rows[0];
    return r ? c.avansKapsamda(k, r) : null;
  }
  async function masrafKapsamda(k, id) {
    const r = (await pool.query(`SELECT mf.id, (${c.kapsamPersonelSql(k)}) AS ok FROM masraf_form mf LEFT JOIN personel p ON p.id = mf.personel_id WHERE mf.id=$1`, [id])).rows[0];
    return r ? r.ok === true : null;
  }
  const kalemFormu = async (id) => (await pool.query(`SELECT form_id FROM masraf_kalem WHERE id=$1`, [id])).rows[0]?.form_id ?? null;
  const belgeFormu = async (sql, v) => (await pool.query(`SELECT mk.form_id FROM masraf_belge mb JOIN masraf_kalem mk ON mk.id = mb.kalem_id WHERE ${sql} ORDER BY mb.id DESC LIMIT 1`, [v])).rows[0]?.form_id ?? null;
  // Sorgudaki kişi (e-posta / personel kimliği) firmanın bordro kapsamında mı; kendisi her zaman serbest
  async function kisiKapsamda(req, k, { email, personelId }) {
    const ben = String(req.user?.email || "").toLowerCase().trim();
    if (email && String(email).toLowerCase().trim() === ben && !personelId) return true;
    const r = personelId
      ? await pool.query(`SELECT UPPER(COALESCE(marka,'ERC')) = ${bordroSql(k)} AS ok FROM personel WHERE id=$1`, [Number(personelId)])
      : await pool.query(`SELECT bool_or(UPPER(COALESCE(marka,'ERC')) = ${bordroSql(k)}) AS ok FROM personel WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM($1))`, [String(email)]);
    return r.rows[0]?.ok === true;
  }
  return async (req, res, next) => {
    try {
      if (req.method === "OPTIONS") return next();
      const u = c.optionalAuth(req);
      if (!u) return next();
      const k = c.altMarkaKapsam(req);
      if (!k) return next();
      const yol = req.path.replace(/\/+$/, "") || "/";
      const m = req.method;
      let x, ok;
      if ((x = yol.match(/^\/hr\/is-avans\/(\d+)(\/[a-z-]+)?$/))) { ok = await avansKapsamda(k, Number(x[1])); if (ok === false) return red(res); }
      else if ((x = yol.match(/^\/hr\/masraf-form\/(\d+)(\/[a-z-]+)?$/))) { ok = await masrafKapsamda(k, Number(x[1])); if (ok === false) return red(res); }
      else if ((x = yol.match(/^\/(tekno-onay|islem-gecmisi)\/(avans|masraf)\/(\d+)$/))) {
        ok = x[2] === "avans" ? await avansKapsamda(k, Number(x[3])) : await masrafKapsamda(k, Number(x[3]));
        if (ok === false) return red(res);
      } else if ((x = yol.match(/^\/hr\/masraf-kalem\/(\d+)(\/[a-z-]+)?$/)) || (x = yol.match(/^\/hr\/masraf-belge\/(\d+)(\/isle)?$/)) && m === "POST") {
        const f = await kalemFormu(Number(x[1]));
        if (f != null && (await masrafKapsamda(k, f)) === false) return red(res);
      } else if (yol === "/hr/masraf-kalem" && m === "POST") {
        const f = Number(req.body?.form_id);
        if (f && (await masrafKapsamda(k, f)) === false) return red(res);
      } else if ((x = yol.match(/^\/hr\/masraf-belge\/(\d+)(\/orijinal)?$/))) {
        const f = await belgeFormu("mb.id=$1", Number(x[1]));
        if (f != null && (await masrafKapsamda(k, f)) === false) return red(res);
      } else if ((x = yol.match(/^\/hr\/masraf-belge\/file\/([^/]+)$/))) {
        const f = await belgeFormu("mb.dosya_adi=$1", decodeURIComponent(x[1]));
        if (f != null && (await masrafKapsamda(k, f)) === false) return red(res);
      } else if ((x = yol.match(/^\/hr\/personel-odeme\/(\d+)$/))) {
        const r = (await pool.query(`SELECT UPPER(COALESCE(firma,'ERC')) AS firma FROM personel_odeme WHERE id=$1`, [Number(x[1])])).rows[0];
        if (r && r.firma !== k.kod) return red(res);
      } else if (yol === "/hr/personel-odeme" && m === "POST") {
        const b = req.body || {};
        if (!b.personel_id && !b.email) return red(res, "Personel seçin");
        if (!(await kisiKapsamda(req, k, { email: b.email, personelId: b.personel_id }))) return red(res, "Bu personel firmanızın kapsamında değil");
        req.body = { ...b, firma: k.kod }; // ödeme kaynağı oturumdaki firma; istemcinin firması kullanılmaz
      } else if ((x = yol.match(/^\/hr\/masraf-form\/bakiye\/(\d+)$/))) {
        if (!(await kisiKapsamda(req, k, { personelId: x[1] }))) return red(res, "Bu personel firmanızın kapsamında değil");
      } else if (m === "GET" && /^\/hr\/(is-avans\/bakiye|is-avans\/hesap|personel-odeme|masraf-formlari)$/.test(yol)) {
        const email = req.query?.email, pid = req.query?.personel_id;
        if ((email || pid) && !(await kisiKapsamda(req, k, { email, personelId: pid }))) return red(res, "Bu personel firmanızın kapsamında değil");
      }
      return next();
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  };
}

// ═══ FİRMA MUHASEBESİ ROL KAPISI (31.10.2026): rol 'firma_muhasebe' yalnız kendi alt markasının (users.marka) iş avansı,
// masraf formu, personel ödemesi ve bunlara bağlı nakit avans hareketlerinde çalışır. Genel 'muhasebe' rolünün geniş
// yetkilerini (finans, fatura, maaş, kasa, HW, Rollout, İK düzenleme…) DEVRALMAZ: izinli yol listesi dışı her istek 403.
// Firma kapsamı yine kapsam kapısında ve uçların kendi alt marka süzgecinde uygulanır.
const FM_OKUMA = [/^\/auth\/me$/, /^\/hr\/is-avans$/, /^\/hr\/is-avans\/(ozet|bakiye|bakiyeler|hesap|excel)$/, /^\/hr\/personel-odeme$/,
  /^\/hr\/masraf-form$/, /^\/hr\/masraf-form\/\d+$/, /^\/hr\/masraf-form\/\d+\/(excel|pdf)$/, /^\/hr\/masraf-form\/bakiye\/\d+$/, /^\/hr\/masraf-form\/donem\/[^/]+\/excel$/,
  /^\/hr\/masraf-formlari$/, /^\/hr\/masraf-belge\/file\/[^/]+$/, /^\/hr\/masraf-belge\/\d+\/orijinal$/, /^\/hr\/masraf-kalem\/\d+\/(odeme-belge|ceza-belge)$/,
  /^\/islem-gecmisi\/(avans|masraf)\/\d+$/, /^\/tekno-onay\/(avans|masraf)\/\d+$/, /^\/onay\/bekleyen$/, /^\/hr\/mobile-dashboard$/, /^\/hr\/personel$/, /^\/hr\/araclar$/, /^\/hr\/personel-secim$/];
const FM_YAZMA = [
  ["POST", /^\/auth\/(login|reset-password-request|reset-password)$/],
  // Teknocenter zinciri: ödeme, İlhami aşamasında vekâleten onay, ödeme aşamasında red, masraf kontrol + arşiv
  ["PUT", /^\/hr\/is-avans\/\d+\/(onayla|direktor-onayla|reddet)$/], ["PUT", /^\/hr\/masraf-form\/\d+\/(onayla|direktor-onayla|arsivle)$/],
  ["POST", /^\/hr\/personel-odeme$/], ["DELETE", /^\/hr\/personel-odeme\/\d+$/], ["POST", /^\/hr\/masraf-kalem\/\d+\/odeme-belge$/],
  // Kendi iş avansı / masrafı (personel akışı; sahiplik uçların kendi kapılarında)
  ["POST", /^\/hr\/is-avans$/], ["PUT", /^\/hr\/is-avans\/\d+$/], ["DELETE", /^\/hr\/is-avans\/\d+$/],
  ["POST", /^\/hr\/masraf-form$/], ["DELETE", /^\/hr\/masraf-form\/\d+$/], ["PUT", /^\/hr\/masraf-form\/\d+\/submit$/],
  ["POST", /^\/hr\/masraf-kalem$/], ["PUT", /^\/hr\/masraf-kalem\/\d+$/], ["DELETE", /^\/hr\/masraf-kalem\/\d+$/], ["POST", /^\/hr\/masraf-kalem\/\d+\/not$/],
  ["POST", /^\/hr\/masraf-belge\/\d+$/], ["DELETE", /^\/hr\/masraf-belge\/\d+$/], ["POST", /^\/hr\/masraf-belge\/\d+\/isle$/],
];
// /hr/personel yanıtından çıkarılan alanlar (maaş / ücret; banka bilgisi ödeme için gerekir ama yalnız kapsam içi personelde)
const FM_GIZLI_PERSONEL = ["net_maas", "bankadan_gosterilen", "elden_verilen", "hakedilen_maas", "hakedis_otomatik", "hakedis_manuel", "manuel_tutar",
  "bankadan", "elden", "extra_hakedis", "maas_gecerli_donem", "brut", "maas", "tc_no", "dogum_tarihi"];
function firmaMuhasebeKapisi(c) {
  return (req, res, next) => {
    if (req.method === "OPTIONS") return next();
    const u = c.optionalAuth(req);
    if (!u || !firmaMuhasebeMi(u)) return next();
    const yol = req.path.replace(/\/+$/, "") || "/";
    const m = req.method === "HEAD" ? "GET" : req.method;
    const red = (msg) => res.status(403).json({ ok: false, error: msg || "Firma muhasebesi rolü bu işlemi yapamaz" });
    // Rol yalnız alt marka hesabında geçerli (firma kapsamı olmayan hesapta hiçbir veri açılmaz)
    if (!c.altMarkaKapsam(req) && yol !== "/auth/me") return red("Firma muhasebesi rolü yalnız alt marka (ör. Teknocenter) hesabında geçerlidir");
    if (m === "GET") {
      if (!FM_OKUMA.some((rx) => rx.test(yol))) return red("Firma muhasebesi rolü bu sayfayı / veriyi göremez");
      if (yol === "/hr/personel") {
        const k = c.altMarkaKapsam(req);
        const orig = res.json.bind(res);
        res.json = (b) => {
          const temiz = (p) => { const x = { ...p }; for (const a of FM_GIZLI_PERSONEL) delete x[a]; return x; };
          const liste = Array.isArray(b) ? b : null;
          return orig(liste ? liste.filter((p) => k.bordro.includes(String(p.personel_marka ?? p.marka ?? "ERC").toUpperCase())).map(temiz) : b);
        };
      }
      return next();
    }
    if (!FM_YAZMA.some(([mt, rx]) => mt === m && rx.test(yol))) return red("Firma muhasebesi rolü bu kaydı değiştiremez");
    return next();
  };
}

module.exports = { semaKur, kur, kapsamKapisi, firmaMuhasebeKapisi, zincirKur, gosterge, ilkAcik, sonrakiAcik, bolgeKodu, FIRMA, ORHAN_EMAIL, BOLGE_MUDURU, DOGRUDAN_PM, ASAMA_TR, VEKALET_NOTU };
