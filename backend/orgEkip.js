// ═══ ORGANİZASYON: FİRMA / EKİP / ÜYELİK YÖNETİMİ (28.10.2026, Orhan) ═══════════════════════════════════════════
// Organizasyon şeması, saha ekip kartları, ekip detayı ve Excel/PNG çıktıları TEK kaynaktan beslenir: GET /org/yapi.
// Paralel firma / personel sistemi kurulmaz; mevcut kimlikler kullanılır:
//   Firma (dış taşeron)  subcons.id — subcon_name iş kayıtlarındaki (master_works.subcon_name) operasyon etiketidir,
//                        DEĞİŞTİRİLMEZ. Görünen ad (gorunen_ad) ve resmi unvan (unvan) ayrı alanlardır; ad düzeltmesi
//                        kimliği, iş etiketlerini, hakediş eşleşmelerini ve geçmiş tutarları etkilemez.
//   Firma (kendi firma)  markalar.kod (ERC / TEKNO …) — kendi ekipleri ekipler.ekip_turu='IC' + bagli_firma
//   Ekip                 ekipler.ekip_no — firma bağlantısı ekipler.firma_id (subcons.id); ad, bölge, açıklama ayrı alanlar
//   Ekip şefi            ekipler.sef_personel_id (yoksa eski kural: ünvanında "şef" geçen üye — yalnız gösterim)
//   Üyelik               personel.ekip_bilgisi GÜNCEL ekibi gösterir (bir kişi aynı anda tek ekipte — mevcut kural);
//                        ekip_uyelik başlangıç / bitiş geçmişini tutar. Ekipten çıkarmak personeli silmez.
// Aktif / pasif: firma (subcons.aktif) ve ekip (ekipler.aktif) ayrı. Pasif firma/ekipte yeni ekip, üye ve iş ataması
// açılmaz (iş ataması kuralı /is-atama'da zaten var); mevcut işler, finans kayıtları ve belgeler değişmez.
// Her değişiklik islem_gecmisi'ne (modul 'firma' | 'ekip') yapan, zaman, önceki/yeni değer ve gerekçeyle yazılır.

const BOLGELER = ["İzmir", "Ankara", "Bursa", "Antalya"];
const ACIK_IS_DURUM = "a.durum NOT IN ('TAMAMLANDI','IPTAL')";
const temiz = (s, n = 200) => String(s ?? "").trim().replace(/\s+/g, " ").slice(0, n);
// Mükerrer kontrolü için katlama: Türkçe büyük harf → ASCII, harf/rakam dışı atılır ("Işık", "IŞIK", "ISIK" aynı)
const katla = (s) => String(s || "").trim().toLocaleUpperCase("tr-TR")
  .replace(/İ/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C")
  .replace(/[^A-Z0-9]+/g, "");
const buyuk = (s) => temiz(s).toLocaleUpperCase("tr-TR");
const bugun = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const tarihMi = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

async function semaKur(pool) {
  const q = (s) => pool.query(s).catch((e) => console.error("[org şema]", e.message));
  await q(`ALTER TABLE ekipler ADD COLUMN IF NOT EXISTS firma_id INTEGER`);
  await q(`ALTER TABLE ekipler ADD COLUMN IF NOT EXISTS sef_personel_id INTEGER`);
  await q(`ALTER TABLE subcons ADD COLUMN IF NOT EXISTS gorunen_ad TEXT`);
  await q(`ALTER TABLE subcons ADD COLUMN IF NOT EXISTS kaynak TEXT`);
  await q(`ALTER TABLE subcons ADD COLUMN IF NOT EXISTS olusturan TEXT`);
  await q(`CREATE TABLE IF NOT EXISTS ekip_uyelik (
    id SERIAL PRIMARY KEY, personel_id INTEGER NOT NULL, ekip_no INTEGER NOT NULL,
    baslangic DATE, bitis DATE, baslatan TEXT, bitiren TEXT, baslangic_gerekce TEXT, bitis_gerekce TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
  await q(`CREATE INDEX IF NOT EXISTS ekip_uyelik_personel_idx ON ekip_uyelik (personel_id)`);
  await q(`CREATE INDEX IF NOT EXISTS ekip_uyelik_ekip_idx ON ekip_uyelik (ekip_no)`);
  // Bir kişinin aynı anda tek açık üyeliği olabilir (personel.ekip_bilgisi tek değer — mevcut kural)
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS ekip_uyelik_acik_uq ON ekip_uyelik (personel_id) WHERE bitis IS NULL`);
  // 06.11.2026: tek ekip kimliği — mükerrer kayıt birleştirme izi, eski görünen adlar, operasyon bağlantısı tarihleri, son teyit.
  // Yalnız ekleme (boş kolonlar); mevcut veri değişmez. Geri dönüş: migrations/2026-11-06_org_ekip_kimlik_geri.sql
  await q(`ALTER TABLE ekipler ADD COLUMN IF NOT EXISTS birlesen_ekip_no INTEGER`);
  await q(`ALTER TABLE ekipler ADD COLUMN IF NOT EXISTS eski_adlar TEXT[]`);
  await q(`ALTER TABLE ekipler ADD COLUMN IF NOT EXISTS operasyon_bas DATE`);
  await q(`ALTER TABLE ekipler ADD COLUMN IF NOT EXISTS operasyon_bit DATE`);
  await q(`ALTER TABLE ekipler ADD COLUMN IF NOT EXISTS teyit_zamani TIMESTAMPTZ`);
  await q(`ALTER TABLE ekipler ADD COLUMN IF NOT EXISTS teyit_eden TEXT`);
}

// ── TEK EKİP KAPSAM KURALI (06.11.2026, Orhan) ─────────────────────────────────────────────────────────────────────
// Bir ekip hangi firmanın operasyonunda? Ekibin ADINDAN değil, ekip satırından okunur ("TEKNO_ ile başlıyor" kuralı yoktur):
//   İç ekip (IC)        → bagli_firma = firma (ekip o firmanın kendi ekibi)
//   Taşeron ekibi (DIS) → bagli_firma = operasyonu yöneten firma VE ekip bir taşeron firma kartına (firma_id) bağlı.
//                         Taşeronun hukuki / finansal kimliği firma kartıdır (subcons); operasyon firması onu DEĞİŞTİRMEZ.
// Org şeması, İş Ata / Plan Yap / Weekly Plan seçicileri, harita ve HW malzeme ekip listesi bu kuralı kullanır.
const ekipTuru = (e) => { const t = String(e?.ekip_turu || "").toUpperCase(); return t === "IC" || t === "DIS" ? t : null; };
const ekipOperasyonFirma = (e) => String(e?.bagli_firma || "").trim().toUpperCase() || null;
function ekipOperasyonda(e, firmaKod) {
  const k = String(firmaKod || "").trim().toUpperCase();
  if (!e || !k || ekipOperasyonFirma(e) !== k) return false;
  const t = ekipTuru(e);
  return t === "IC" || (t === "DIS" && !!e.firma_id);
}
// Mükerrer kayıt olarak başka ekibe birleştirilmiş satır (aktif şemada ve seçicilerde yer almaz; kimlik izi için durur)
const ekipBirlesmis = (e) => e?.birlesen_ekip_no != null;
const plakaNorm = (p) => String(p || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
const TUR_AD = { IC: "İç ekip", DIS: "Taşeron ekibi" };

// Ekibe işaret eden kayıtlar (kimlik = ekipler.ekip_no). Birleştirme / operasyondan çıkarma öncesi rapor için; tablo yoksa null.
async function ekipBaglantilari(db, no) {
  const n = Number(no), s = String(n);
  const say = async (sql, p) => { try { return Number((await db.query(sql, p)).rows[0]?.n || 0); } catch (e) { return null; } };
  return {
    personel: await say(`SELECT COUNT(*) n FROM personel WHERE TRIM(COALESCE(ekip_bilgisi,''))=$1`, [s]),
    uyelik_gecmisi: await say(`SELECT COUNT(*) n FROM ekip_uyelik WHERE ekip_no=$1`, [n]),
    calisma_donemi: await say(`SELECT COUNT(*) n FROM personel_calisma_donemi WHERE TRIM(COALESCE(ekip_bilgisi,''))=$1`, [s]),
    is_atama: await say(`SELECT COUNT(*) n FROM is_atama WHERE ekip_no=$1`, [n]),
    acik_is_atama: await say(`SELECT COUNT(*) n FROM is_atama a WHERE a.ekip_no=$1 AND ${ACIK_IS_DURUM}`, [n]),
    plan_kayit: await say(`SELECT COUNT(*) n FROM plan_kayit WHERE ekip_no=$1`, [n]),
    plan_segment: await say(`SELECT COUNT(*) n FROM is_atama_plan_segment WHERE ekip_no=$1`, [n]),
    fiili_bildirim: await say(`SELECT COUNT(*) n FROM is_fiili_bildirim WHERE ekip_no=$1`, [n]),
    taseron_hesap_uyesi: await say(`SELECT COUNT(*) n FROM taseron_saha_uye WHERE ekip_no=$1`, [n]),
    taseron_bildirim: await say(`SELECT COUNT(*) n FROM taseron_saha_bildirim WHERE ekip_no=$1`, [n]),
    arac_tahsis: await say(`SELECT COUNT(*) n FROM arac_tahsis WHERE ekip_no=$1 AND NOT iptal`, [n]),
    hw_malzeme_islem: await say(`SELECT COUNT(*) n FROM hw_malzeme_islem WHERE (kaynak_tip='EKIP' AND kaynak_id=$1) OR (hedef_tip='EKIP' AND hedef_id=$1)`, [s]),
  };
}
// Kimliğe bağlı (ad değişse de ekipte kalan) bağlantı var mı — iş etiketleri ayrı taşınır, burada sayılmaz
const baglantiVar = (b) => Object.entries(b).some(([k, v]) => k !== "acik_is_atama" && Number(v) > 0);
const BAGLANTI_TR = { personel: "güncel personel", uyelik_gecmisi: "üyelik geçmişi", calisma_donemi: "çalışma dönemi", is_atama: "iş ataması", acik_is_atama: "açık iş ataması",
  plan_kayit: "plan kaydı", plan_segment: "Weekly Plan segmenti", fiili_bildirim: "saha bildirimi", taseron_hesap_uyesi: "taşeron mobil hesabı", taseron_bildirim: "taşeron bildirimi",
  arac_tahsis: "araç tahsisi", hw_malzeme_islem: "HW malzeme hareketi" };

// MÜKERRER EKİP BİRLEŞTİRME — plan (yalnız okuma). kaynak = boş mükerrer kayıt, hedef = personel / geçmişi taşıyan asıl kimlik.
// Hedefin kimliği (ekip_no) ve tüm bağlantıları AYNEN kalır; yalnız görünen adı güncellenir, eski adı eski_adlar'a yazılır ve
// kaynağın iş etiketleri hedefe eklenir (eski etiketler de durur → geçmiş iş kayıtları bulunmaya devam eder).
// Kaynak silinmez: pasife alınır, birlesen_ekip_no = hedef (geri alınabilir). Kaynakta kimliğe bağlı kayıt varsa işlem durur → önce rapor.
async function birlestirPlan(db, kaynakNo, hedefNo, secenek = {}) {
  const oku = async (no) => (await db.query(`SELECT * FROM ekipler WHERE ekip_no=$1`, [Number(no)])).rows[0] || null;
  const kaynak = await oku(kaynakNo), hedef = await oku(hedefNo);
  const engeller = [];
  if (!kaynak || !hedef) return { uygun: false, engeller: ["Ekip bulunamadı"], kaynak, hedef };
  if (kaynak.ekip_no === hedef.ekip_no) engeller.push("Bir ekip kendisiyle birleştirilemez");
  if (ekipBirlesmis(kaynak)) engeller.push(`${kaynak.ad} zaten Ekip ${kaynak.birlesen_ekip_no} ile birleştirilmiş`);
  if (ekipBirlesmis(hedef)) engeller.push(`${hedef.ad} birleştirilmiş bir kayıt — hedef olamaz`);
  if (ekipTuru(kaynak) !== ekipTuru(hedef)) engeller.push(`Ekip türleri farklı (${TUR_AD[ekipTuru(kaynak)] || "tanımsız"} / ${TUR_AD[ekipTuru(hedef)] || "tanımsız"}) — tür isimden tahmin edilmez`);
  if (ekipOperasyonFirma(kaynak) !== ekipOperasyonFirma(hedef)) engeller.push("Bağlı / operasyon firmaları farklı");
  if ((kaynak.firma_id || null) !== (hedef.firma_id || null)) engeller.push("Taşeron firma kartları farklı");
  const kb = await ekipBaglantilari(db, kaynak.ekip_no), hb = await ekipBaglantilari(db, hedef.ekip_no);
  const dolu = Object.entries(kb).filter(([k, v]) => k !== "acik_is_atama" && Number(v) > 0);
  if (dolu.length) engeller.push(`${kaynak.ad} (Ekip ${kaynak.ekip_no}) kaydında bağlantı var: ${dolu.map(([k, v]) => `${v} ${BAGLANTI_TR[k]}`).join(", ")} — önce bunlar için karar verilmeli`);
  const up = (x) => String(x || "").trim().toUpperCase();
  const etiketler = [...new Set([...(hedef.is_etiketleri || []), ...(kaynak.is_etiketleri || [])].map(up).filter(Boolean))];
  const yeniAd = temiz(secenek.ad, 80) || kaynak.ad;
  const eskiAdlar = [...new Set([...(hedef.eski_adlar || []), ...(temiz(hedef.ad) !== yeniAd ? [hedef.ad] : [])].filter(Boolean))];
  const isSay = async (et) => { try { return Number((await db.query(`SELECT COUNT(*) n FROM master_works WHERE UPPER(TRIM(subcon_name)) = ANY($1::text[])`, [et.map(up)])).rows[0].n); } catch (e) { return null; } };
  return {
    uygun: engeller.length === 0, engeller, kaynak, hedef,
    kaynak_baglanti: kb, hedef_baglanti: hb,
    etiket_is: { hedef_once: await isSay(hedef.is_etiketleri || []), kaynak: await isSay(kaynak.is_etiketleri || []), sonra: await isSay(etiketler) },
    sonuc: {
      hedef: { ekip_no: hedef.ekip_no, ad: yeniAd, eski_adlar: eskiAdlar, is_etiketleri: etiketler,
        ekip_sira: secenek.sira != null ? Number(secenek.sira) : (hedef.ekip_sira ?? kaynak.ekip_sira ?? null), aciklama: hedef.aciklama || kaynak.aciklama || null },
      kaynak: { ekip_no: kaynak.ekip_no, ad: kaynak.ad, aktif: false, birlesen_ekip_no: hedef.ekip_no, is_etiketleri: [], ekip_sira: null },
    },
  };
}
// Uygulama: çağıran transaction içinde çalıştırır. yaz(modul, kayitId, tip, eski, yeni, aciklama) = işlem geçmişi yazıcısı.
async function birlestirUygula(db, plan, yaz, gerekce) {
  if (!plan.uygun) throw Object.assign(new Error(plan.engeller.join(" · ")), { kullanici: true });
  const { kaynak, hedef, sonuc } = plan;
  const oz = (e) => ({ ad: e.ad, aktif: e.aktif !== false, is_etiketleri: e.is_etiketleri || [], eski_adlar: e.eski_adlar || [], ekip_sira: e.ekip_sira ?? null,
    aciklama: e.aciklama || null, birlesen_ekip_no: e.birlesen_ekip_no ?? null });
  // sıra benzersizdir: önce kaynağın sırası boşaltılır
  await db.query(`UPDATE ekipler SET aktif=false, birlesen_ekip_no=$2, is_etiketleri='{}', ekip_sira=NULL, updated_at=NOW() WHERE ekip_no=$1`, [kaynak.ekip_no, hedef.ekip_no]);
  await db.query(`UPDATE ekipler SET ad=$2, eski_adlar=$3, is_etiketleri=$4, ekip_sira=$5, aciklama=$6, updated_at=NOW() WHERE ekip_no=$1`,
    [hedef.ekip_no, sonuc.hedef.ad, sonuc.hedef.eski_adlar, sonuc.hedef.is_etiketleri, sonuc.hedef.ekip_sira, sonuc.hedef.aciklama]);
  await yaz("ekip", hedef.ekip_no, "BIRLESTIRME", { ...oz(hedef), birlesen_kayit: null }, { ...sonuc.hedef, birlesen_kayit: kaynak.ekip_no }, gerekce);
  await yaz("ekip", kaynak.ekip_no, "BIRLESTIRILDI", oz(kaynak), { ...sonuc.kaynak, hedef_onceki: oz(hedef) }, gerekce);
  return sonuc;
}
// Geri alma: kaynağın son BIRLESTIRILDI kaydındaki önceki değerler geri yazılır; hedefe sonradan eklenen üye / iş / araç AYNEN kalır.
async function birlestirGeriAl(db, kaynakNo, yaz, gerekce) {
  const kaynak = (await db.query(`SELECT * FROM ekipler WHERE ekip_no=$1`, [Number(kaynakNo)])).rows[0];
  if (!kaynak || !ekipBirlesmis(kaynak)) throw Object.assign(new Error("Bu ekip birleştirilmiş bir kayıt değil"), { kullanici: true });
  const g = (await db.query(`SELECT eski, yeni FROM islem_gecmisi WHERE modul='ekip' AND kayit_id=$1 AND tip='BIRLESTIRILDI' ORDER BY id DESC LIMIT 1`, [kaynak.ekip_no])).rows[0];
  const coz = (v) => (typeof v === "string" ? JSON.parse(v) : v) || {};
  if (!g) throw Object.assign(new Error("Birleştirme kaydı bulunamadı — geri alınamıyor"), { kullanici: true });
  const ko = coz(g.eski), ho = coz(g.yeni).hedef_onceki || {};
  const hedef = (await db.query(`SELECT * FROM ekipler WHERE ekip_no=$1`, [kaynak.birlesen_ekip_no])).rows[0];
  if (!hedef) throw Object.assign(new Error("Hedef ekip bulunamadı"), { kullanici: true });
  const up = (x) => String(x || "").trim().toUpperCase();
  const kEt = (ko.is_etiketleri || []).map(up);
  // Hedef: yalnız kaynaktan gelen etiketler çıkar; ad birleştirmede verilen adsa önceki ada döner; sıra önceki değerine döner
  const hEt = (hedef.is_etiketleri || []).filter((t) => !kEt.includes(up(t)) || (ho.is_etiketleri || []).map(up).includes(up(t)));
  const adDon = katla(hedef.ad) === katla(ko.ad) && ho.ad;
  await db.query(`UPDATE ekipler SET ad=$2, eski_adlar=$3, is_etiketleri=$4, ekip_sira=$5, updated_at=NOW() WHERE ekip_no=$1`,
    [hedef.ekip_no, adDon ? ho.ad : hedef.ad, adDon ? (ho.eski_adlar || []) : (hedef.eski_adlar || []), hEt, ho.ekip_sira ?? null]);
  await db.query(`UPDATE ekipler SET aktif=$2, birlesen_ekip_no=NULL, is_etiketleri=$3, ekip_sira=$4, updated_at=NOW() WHERE ekip_no=$1`,
    [kaynak.ekip_no, ko.aktif !== false, ko.is_etiketleri || [], ko.ekip_sira ?? null]);
  await yaz("ekip", hedef.ekip_no, "BIRLESTIRME_GERI", { ad: hedef.ad, is_etiketleri: hedef.is_etiketleri || [] }, { ad: adDon ? ho.ad : hedef.ad, is_etiketleri: hEt }, gerekce);
  await yaz("ekip", kaynak.ekip_no, "BIRLESTIRME_GERI", { aktif: false, birlesen_ekip_no: hedef.ekip_no }, { aktif: ko.aktif !== false, is_etiketleri: ko.is_etiketleri || [] }, gerekce);
  return { kaynak: kaynak.ekip_no, hedef: hedef.ekip_no };
}

function kur(app, c) {
  const { pool, authMiddleware, islemGecmisiYaz, altMarkaKullanicisi, detectTenant } = c;
  const hata = (res, kod, mesaj, ek) => res.status(kod).json({ ok: false, error: mesaj, ...(ek || {}) });
  const rolOf = (u) => String(u?.role || "").toLowerCase();

  // ── YETKİ ───────────────────────────────────────────────────────────────────────────────────────────────────
  // Görme: ERC kiracısındaki şirket içi herkes (bugünkü davranış — şema herkese açık); taşeron ve başka kiracı göremez.
  // Yönetme (org_yonet) ve silme (org_sil): kullanıcı yetki ayarı (users.yetki_ayar) ya da ERC tam admin rolü varsayılanı.
  // Bu izinler maaş, bordro, finans ya da kullanıcı yetkisi VERMEZ (onlar ayrı izin / kapılardır).
  // Alt marka hesabı (Teknocenter vb.) yalnız kendi firmasının (bagli_firma) ekiplerini görür ve — izni varsa — yönetir.
  function orgYetki(req) {
    const u = req.user || {};
    if (rolOf(u) === "subcon") return { gor: false };
    const tenant = String(u.tenant || detectTenant(u.email, u.subcon_name) || "").toLowerCase();
    if (tenant !== "erc") return { gor: false };
    const alt = altMarkaKullanicisi(u) ? String(u.marka || "").toUpperCase() : null;
    const iz = req.izinler || {};
    const tamAdmin = ["admin", "platform_admin"].includes(rolOf(u)) && !alt;
    const yonet = iz.org_yonet === true || (iz.org_yonet !== false && tamAdmin);
    const sil = yonet && (iz.org_sil === true || (iz.org_sil !== false && tamAdmin));
    return { gor: true, yonet, sil, marka: alt };
  }
  const gorKapisi = [authMiddleware, (req, res, next) => (orgYetki(req).gor ? next() : hata(res, 403, "Organizasyon bilgisine erişim yetkiniz yok"))];
  const yonetKapisi = [authMiddleware, (req, res, next) => (orgYetki(req).yonet ? next() : hata(res, 403, "Organizasyon / ekip yönetimi yetkiniz yok"))];
  const silKapisi = [authMiddleware, (req, res, next) => (orgYetki(req).sil ? next() : hata(res, 403, "Kayıt silme yetkiniz yok"))];
  // Alt marka kapsamı (06.11.2026): kendi iç ekipleri + kendi operasyonuna bağlı, firma kartı doğrulanmış taşeron ekipleri
  // (ekipOperasyonda). Başka firmanın ekibi açılmaz. Taşeron FİRMA kartı işlemleri (ad, unvan, durum, silme) ERC'ye aittir.
  const ekipKapsamda = (req, e) => { const m = orgYetki(req).marka; return !m || ekipOperasyonda(e, m); };
  const firmaIslemiKapsamda = (req) => !orgYetki(req).marka;
  const kim = (req) => String(req.user?.email || "").toLowerCase().trim() || null;
  const yaz = (req) => (modul, id, tip, eski, yeni, aciklama) => islemGecmisiYaz(req, modul, id, tip, eski, yeni, aciklama);
  const degisti = () => { try { c.ekipDegisti && c.ekipDegisti(); } catch (e) { /* önbellek temizliği işlemi düşürmez */ } };
  const tabloVar = async (ad, db = pool) => !!(await db.query(`SELECT to_regclass($1) AS t`, [`public.${ad}`]).catch(() => ({ rows: [] }))).rows[0]?.t;
  async function markaKodlari() {
    const r = await pool.query(`SELECT kod, ad FROM markalar WHERE COALESCE(aktif,true)`).catch(() => ({ rows: [] }));
    const m = new Map(r.rows.map((x) => [String(x.kod).toUpperCase(), x.ad]));
    if (!m.has("ERC")) m.set("ERC", "Şimşek Haberleşme");
    return m;
  }

  // ── OKUMA YARDIMCILARI ──────────────────────────────────────────────────────────────────────────────────────
  const firmaGorunen = (f) => (f ? temiz(f.gorunen_ad) || temiz(f.subcon_name) : null);
  async function firmaOku(id, db = pool) {
    const r = await db.query(`SELECT id, subcon_name, unvan, gorunen_ad, ana_firma, COALESCE(aktif,true) AS aktif, kaynak, created_at FROM subcons WHERE id=$1`, [Number(id)]);
    return r.rows[0] || null;
  }
  async function ekipOku(no, db = pool) {
    const r = await db.query(`SELECT * FROM ekipler WHERE ekip_no=$1`, [Number(no)]);
    return r.rows[0] || null;
  }
  // Ekipte sayılan kişi: aktif, ayrılış tarihi gelmemiş, güncel ekibi bu ekip (şema / kart / Excel aynı kural)
  const UYE_SQL = `SELECT p.id, p.ad_soyad, p.unvan, p.telefon, p.ekip_arac_plaka, p.ekip_bilgisi, COALESCE(p.firma_tipi,'simsek') AS firma_tipi,
      p.alt_yuklenici, COALESCE(p.marka,'ERC') AS marka,
      (SELECT to_char(u.baslangic,'YYYY-MM-DD') FROM ekip_uyelik u WHERE u.personel_id=p.id AND u.bitis IS NULL LIMIT 1) AS uyelik_baslangic
    FROM personel p
    WHERE COALESCE(p.aktif,true) AND p.birlestirildi_personel_id IS NULL
      AND (p.isten_ayrilma_tarihi IS NULL OR p.isten_ayrilma_tarihi > CURRENT_DATE)
      AND TRIM(COALESCE(p.ekip_bilgisi,'')) <> ''`;
  async function uyeleriOku(db = pool) {
    const r = await db.query(UYE_SQL).catch(async (e) => {
      // birlestirildi_personel_id kolonu olmayan kurulum (eski şema) — aynı kural, kolonsuz
      if (!/birlestirildi_personel_id/.test(e.message)) throw e;
      return db.query(UYE_SQL.replace("AND p.birlestirildi_personel_id IS NULL", ""));
    });
    return r.rows;
  }
  const sefMiUnvan = (p) => /şef|sef/i.test(String(p?.unvan || ""));

  // ── ARAÇ ↔ EKİP (06.11.2026) ────────────────────────────────────────────────────────────────────────────────
  // Geçerli araç tek yerden çözülür; kaynaklar ayrı taşınır ve çelişki gizlenmez:
  //   TAHSIS          tarihli araç tahsisi (arac_tahsis: ekip ya da üye → araç, bugün geçerli)   → doğrulanmış
  //   PERSONEL_KARTI  personel.ekip_arac_plaka (tarihsiz)                                        → teyit bekler
  //   ARAC_KARTI      araclar.surucu metni, ekip üyesiyle TEKİL tam ad eşleşmesi (tarihsiz)       → teyit bekler
  //   EKIP_KAYDI      ekipler.plaka (eski alan)                                                   → teyit bekler
  // Sorgu hatası "araç yok" sayılmaz: durum VERI_YOK döner (ekranda "Veri alınamadı"); hiç kaynak yoksa ATANMADI.
  async function aracVerisi(db = pool) {
    try {
      const ar = (await db.query(`SELECT id, plaka, marka, model, surucu, firma, COALESCE(aktif,true) AS aktif, durum FROM araclar`)).rows
        .map((a) => ({ ...a, plaka_n: plakaNorm(a.plaka) }));
      const kurulu = await tabloVar("arac_tahsis", db);
      const th = kurulu ? (await db.query(`SELECT id, arac_id, plaka, personel_id, ekip_no, bas::text AS bas, bit::text AS bit, aciklama FROM arac_tahsis
        WHERE NOT iptal AND bas <= $1::date AND (bit IS NULL OR bit >= $1::date)`, [bugun()])).rows.map((t) => ({ ...t, id: Number(t.id), plaka_n: plakaNorm(t.plaka) })) : [];
      return { hata: false, araclar: ar, plakaMap: new Map(ar.map((a) => [a.plaka_n, a])), tahsisler: th, tahsis_kurulu: kurulu };
    } catch (e) { console.error("[org araç]", e.message); return { hata: true, araclar: [], plakaMap: new Map(), tahsisler: [], tahsis_kurulu: false }; }
  }
  const aracAktif = (a) => a && a.aktif !== false && !/^pas[iİı]f$/i.test(String(a.durum || "").trim());
  function ekipAraclari(e, uyeler, A, tumUyeler) {
    if (A.hata) return { durum: "VERI_YOK", liste: [], uyarilar: [] };
    const liste = [], uyarilar = [];
    const uyeId = new Set(uyeler.map((p) => p.id));
    const ekle = (plakaN, ham, kaynak, ek) => {
      if (!plakaN) return;
      let x = liste.find((a) => a.plaka_n === plakaN);
      if (!x) {
        const ar = A.plakaMap.get(plakaN);
        x = { plaka_n: plakaN, plaka: ar?.plaka || ham, arac_id: ar?.id || null, arac: ar ? [ar.marka, ar.model].filter(Boolean).join(" ") || null : null,
          kayitli: !!ar, arac_aktif: ar ? aracAktif(ar) : null, dogrulanmis: false, kaynaklar: [] };
        liste.push(x);
      }
      x.kaynaklar.push({ kaynak, ...ek });
      if (kaynak === "TAHSIS") x.dogrulanmis = true;
    };
    for (const t of A.tahsisler) if (Number(t.ekip_no) === Number(e.ekip_no) || (t.personel_id && uyeId.has(t.personel_id)))
      ekle(t.plaka_n, t.plaka, "TAHSIS", { tahsis_id: t.id, bas: t.bas, bit: t.bit, personel_id: t.personel_id || null, ekip: !!t.ekip_no });
    for (const p of uyeler) {
      const n = plakaNorm(p.ekip_arac_plaka);
      if (!n) continue;
      ekle(n, p.ekip_arac_plaka, "PERSONEL_KARTI", { personel_id: p.id, ad: p.ad_soyad });
      const ar = A.plakaMap.get(n);
      if (!ar) uyarilar.push(`${p.ad_soyad} personel kartındaki ${p.ekip_arac_plaka} plakası araç kayıtlarında yok`);
      else if (!aracAktif(ar)) uyarilar.push(`${p.ad_soyad} personel kartındaki ${ar.plaka} aracı pasif`);
    }
    for (const a of A.araclar) {
      if (!aracAktif(a) || !katla(a.surucu)) continue;
      const es = tumUyeler.filter((p) => katla(p.ad_soyad) === katla(a.surucu));
      if (es.length !== 1 || !uyeId.has(es[0].id)) continue; // belirsiz ad ya da başka ekibin üyesi → bağ kurulmaz
      ekle(a.plaka_n, a.plaka, "ARAC_KARTI", { personel_id: es[0].id, ad: es[0].ad_soyad });
      const pk = plakaNorm(es[0].ekip_arac_plaka);
      if (pk && pk !== a.plaka_n) uyarilar.push(`${es[0].ad_soyad}: personel kartında ${es[0].ekip_arac_plaka}, araç kartında ${a.plaka} — plaka teyit edilmeli`);
    }
    if (plakaNorm(e.plaka)) ekle(plakaNorm(e.plaka), e.plaka, "EKIP_KAYDI", {});
    const dogru = liste.filter((a) => a.dogrulanmis);
    // Tahsis varsa geçerli araç odur; tarihsiz kaynaklar yalnız çelişki uyarısı olarak kalır
    if (dogru.length) for (const a of liste) if (!a.dogrulanmis) uyarilar.push(`${a.plaka} tarihsiz kayıtta görünüyor ama geçerli tahsis ${dogru.map((d) => d.plaka).join(", ")}`);
    return { durum: dogru.length ? "TAHSISLI" : liste.length ? "TEYIT_BEKLIYOR" : "ATANMADI", liste: dogru.length ? dogru : liste, tarihsiz: dogru.length ? liste.filter((a) => !a.dogrulanmis) : [],
      uyarilar: [...new Set(uyarilar)] };
  }

  // Tek kaynak: firmalar + ekipler (+ üyeler, şef, araç, tür, operasyon, durum, kişi sayısı)
  async function yapiOku(req) {
    const y = orgYetki(req);
    const [ekTum, uy, mk, A] = await Promise.all([
      pool.query(`SELECT * FROM ekipler ORDER BY (ekip_sira IS NULL), ekip_sira, ekip_no`),
      uyeleriOku(),
      pool.query(`SELECT kod, ad FROM markalar`).catch(() => ({ rows: [] })),
      aracVerisi(),
    ]);
    // Başka ekibe birleştirilmiş mükerrer kayıtlar aktif yapıda yer almaz (kimlik izi "birlesenler" altında, yalnız yöneticiye)
    const ek = { rows: ekTum.rows.filter((e) => !ekipBirlesmis(e)) };
    const birlesenler = ekTum.rows.filter(ekipBirlesmis).map((e) => ({ ekip_no: e.ekip_no, ad: e.ad, hedef_ekip_no: e.birlesen_ekip_no, ekip_turu: e.ekip_turu, bagli_firma: e.bagli_firma, firma_id: e.firma_id }));
    const firmaIdleri = [...new Set(ek.rows.map((e) => e.firma_id).filter(Boolean))];
    const fq = await pool.query(`SELECT id, subcon_name, unvan, gorunen_ad, ana_firma, COALESCE(aktif,true) AS aktif, kaynak
      FROM subcons WHERE id = ANY($1::int[]) OR kaynak = 'ORG' ORDER BY id`, [firmaIdleri]);
    const firmaMap = new Map(fq.rows.map((f) => [f.id, f]));
    const markaAd = new Map(mk.rows.map((m) => [String(m.kod).toUpperCase(), m.ad]));
    if (!markaAd.has("ERC")) markaAd.set("ERC", "Şimşek Haberleşme");
    const uyeMap = new Map();
    for (const p of uy) { const k = String(p.ekip_bilgisi).trim(); if (!uyeMap.has(k)) uyeMap.set(k, []); uyeMap.get(k).push(p); }
    let ekipler = ek.rows.map((e) => {
      const f = e.firma_id ? firmaMap.get(e.firma_id) : null;
      const uyeler = (uyeMap.get(String(e.ekip_no)) || []).sort((a, b) =>
        (Number(b.id === e.sef_personel_id) - Number(a.id === e.sef_personel_id)) || (sefMiUnvan(b) - sefMiUnvan(a)) || String(a.ad_soyad).localeCompare(String(b.ad_soyad), "tr"));
      const sef = e.sef_personel_id ? uyeler.find((p) => p.id === e.sef_personel_id) || null : null;
      const firmaAktif = f ? f.aktif !== false : true;
      const tur = ekipTuru(e), op = ekipOperasyonFirma(e);
      // Firma ve ekip adı aynıysa tekrar üretilmez ("TEKNO_EMRAH — TEKNO_EMRAH" yazılmaz)
      const firmaAd = f ? firmaGorunen(f) : null;
      return {
        ...e,
        tur, tur_ad: TUR_AD[tur] || "Sınıflandırılmamış",
        operasyon_firma: op, operasyon_ad: op ? markaAd.get(op) || op : null,
        firma_gorunen: firmaAd,
        firma_ad_ayni: !!firmaAd && katla(firmaAd) === katla(e.ad),
        firma_aktif: firmaAktif,
        firma_bagli: !!f,
        bagli_firma_ad: tur === "IC" && op ? markaAd.get(op) || op : null,
        etkin: e.aktif !== false && firmaAktif,
        uye_sayisi: uyeler.length,
        sef: sef ? { id: sef.id, ad_soyad: sef.ad_soyad } : null,
        sef_eski_kural: !e.sef_personel_id ? (uyeler.find(sefMiUnvan) ? { id: uyeler.find(sefMiUnvan).id, ad_soyad: uyeler.find(sefMiUnvan).ad_soyad } : null) : null,
        sef_gerekli: !!e.sef_personel_id && !sef,
        uyeler,
        arac: ekipAraclari(e, uyeler, A, uy),
        eski_adlar: e.eski_adlar || [],
        teyit: e.teyit_zamani ? { zaman: e.teyit_zamani, eden: e.teyit_eden || null } : null,
      };
    });
    if (y.marka) ekipler = ekipler.filter((e) => ekipKapsamda(req, e));
    // Sıra: önce iç ekipler, sonra taşeron ekipleri, sonra sınıflandırılmamış eski kayıtlar; grup içinde ekip_sira → ekip_no
    const turSira = (e) => (e.tur === "IC" ? 0 : e.tur === "DIS" ? 1 : 2);
    ekipler.sort((a, b) => turSira(a) - turSira(b) || (a.ekip_sira == null) - (b.ekip_sira == null) || (a.ekip_sira || 0) - (b.ekip_sira || 0) || a.ekip_no - b.ekip_no);
    // Firma kartları: kayıtlı dış taşeron firmaları + firma kaydına bağlanmamış eski ekiplerin serbest taşeron adı
    // + kendi firmamızın ekipleri (markalar). Kayıt olmayan gruplar düzenlenemez; ekip "Düzenle" ile firmaya bağlanır.
    // Alt marka: yalnız kendi operasyonundaki ekiplerin firma kartı, salt okunur özetle (unvan / kaynak / başka ekip sayısı verilmez).
    const firmalar = [];
    for (const f of fq.rows) {
      const list = ekipler.filter((e) => e.firma_id === f.id);
      if (y.marka) { if (list.length) firmalar.push({ tip: "TASERON", id: f.id, anahtar: `F${f.id}`, ad: firmaGorunen(f), aktif: f.aktif !== false, salt_okunur: true,
        ekip_sayisi: list.length, aktif_ekip: list.filter((e) => e.aktif !== false).length, kisi: list.reduce((s, e) => s + e.uye_sayisi, 0) }); continue; }
      firmalar.push({ tip: "TASERON", id: f.id, anahtar: `F${f.id}`, ad: firmaGorunen(f), subcon_name: f.subcon_name, unvan: f.unvan || null,
        gorunen_ad: f.gorunen_ad || null, aktif: f.aktif !== false, kaynak: f.kaynak || null,
        ekip_sayisi: list.length, aktif_ekip: list.filter((e) => e.aktif !== false).length, kisi: list.reduce((s, e) => s + e.uye_sayisi, 0) });
    }
    const serbest = new Map();
    for (const e of ekipler) {
      if (e.firma_id) continue;
      const key = e.ekip_turu === "IC" ? `M:${String(e.bagli_firma || "ERC").toUpperCase()}` : temiz(e.taseron_adi) ? `S:${katla(e.taseron_adi)}` : "M:ERC";
      if (!serbest.has(key)) serbest.set(key, { tip: key.startsWith("M:") ? "KENDI" : "BAGLANMAMIS", id: null, anahtar: key,
        ad: key.startsWith("M:") ? (markaAd.get(key.slice(2)) || key.slice(2)) : temiz(e.taseron_adi), aktif: true, ekip_sayisi: 0, aktif_ekip: 0, kisi: 0 });
      const g = serbest.get(key); g.ekip_sayisi++; if (e.aktif !== false) g.aktif_ekip++; g.kisi += e.uye_sayisi;
      e.firma_anahtar = key;
    }
    for (const e of ekipler) if (e.firma_id) e.firma_anahtar = `F${e.firma_id}`;
    firmalar.push(...serbest.values());
    const operasyonlar = [...new Set(ekipler.map((e) => e.operasyon_firma).filter(Boolean))].map((k) => ({ kod: k, ad: markaAd.get(k) || k }));
    return { firmalar, ekipler, bolgeler: BOLGELER, operasyonlar, arac_tahsis_kurulu: A.tahsis_kurulu, arac_veri_hatasi: A.hata,
      birlesenler: y.yonet ? (y.marka ? birlesenler.filter((b) => ekipOperasyonda(b, y.marka)) : birlesenler) : [],
      izinler: { yonet: y.yonet, sil: y.sil, marka: y.marka || null } };
  }

  app.get("/org/yapi", gorKapisi, async (req, res) => {
    try { res.json({ ok: true, ...(await yapiOku(req)) }); }
    catch (e) { console.error("[org/yapi]", e.message); hata(res, 500, "Organizasyon bilgisi alınamadı"); }
  });

  // ── FİRMA (dış taşeron) ─────────────────────────────────────────────────────────────────────────────────────
  // Mükerrer kontrolü: katlanmış ad (Türkçe harf / boşluk / noktalama duyarsız) subcon_name, görünen ad, resmi unvan ya da
  // takma adlardan biriyle AYNIYSA yeni kayıt açılmaz → mevcut firma önerilir. Yalnız benzerlik (önek) uyarıdır, birleştirme yapılmaz.
  async function firmaMukerrer(ad, haricId = null) {
    const k = katla(ad);
    if (!k) return { ayni: [], benzer: [] };
    const r = await pool.query(`SELECT s.id, s.subcon_name, s.gorunen_ad, s.unvan, COALESCE(s.aktif,true) AS aktif,
        ARRAY(SELECT t.ad FROM subcon_takma_ad t WHERE t.subcon_id = s.id) AS takma FROM subcons s`).catch(() => ({ rows: [] }));
    const ayni = [], benzer = [];
    for (const f of r.rows) {
      if (haricId && f.id === haricId) continue;
      const adlar = [f.subcon_name, f.gorunen_ad, f.unvan, ...(f.takma || [])].map(katla).filter(Boolean);
      const ozet = { id: f.id, ad: firmaGorunen(f), unvan: f.unvan || null, aktif: f.aktif };
      if (adlar.includes(k)) ayni.push(ozet);
      else if (k.length >= 3 && adlar.some((a) => a.startsWith(k) || k.startsWith(a))) benzer.push(ozet);
    }
    return { ayni, benzer: benzer.slice(0, 5) };
  }
  async function firmaOlustur(db, req, { ad, unvan, gerekce }) {
    const subconName = buyuk(ad);
    const r = await db.query(`INSERT INTO subcons (subcon_name, gorunen_ad, unvan, ana_firma, aktif, kaynak, olusturan)
      VALUES ($1,$2,$3,'ERC',true,'ORG',$4) RETURNING id, subcon_name, gorunen_ad, unvan, aktif`, [subconName, temiz(ad), temiz(unvan, 300) || null, kim(req)]);
    await islemGecmisiYaz(req, "firma", r.rows[0].id, "OLUSTURMA", null, { ad: temiz(ad), unvan: temiz(unvan, 300) || null, durum: "Aktif" }, gerekce || null);
    return r.rows[0];
  }
  app.get("/org/firma/kontrol", yonetKapisi, async (req, res) => {
    try { res.json({ ok: true, ...(await firmaMukerrer(req.query.ad, Number(req.query.haric) || null)) }); }
    catch (e) { hata(res, 500, "Kontrol yapılamadı"); }
  });
  app.post("/org/firma", yonetKapisi, async (req, res) => {
    try {
      if (!firmaIslemiKapsamda(req)) return hata(res, 403, "Taşeron firma kaydı yalnız ana firma tarafından açılır");
      const ad = temiz(req.body?.ad, 120), unvan = temiz(req.body?.unvan, 300), gerekce = temiz(req.body?.gerekce, 500);
      if (ad.length < 2) return hata(res, 400, "Firma adı gerekli");
      const m = await firmaMukerrer(ad);
      if (m.ayni.length) return hata(res, 409, `"${ad}" zaten kayıtlı: ${m.ayni.map((x) => x.ad).join(", ")}. Mevcut firmayı kullanın.`, { mevcut: m.ayni });
      const f = await firmaOlustur(pool, req, { ad, unvan, gerekce });
      res.json({ ok: true, firma: f, benzer: m.benzer });
    } catch (e) {
      if (/subcons_subcon_name_key|duplicate key/.test(e.message)) return hata(res, 409, "Bu adla bir firma kaydı zaten var");
      console.error("[org/firma]", e.message); hata(res, 500, "Firma kaydedilemedi");
    }
  });
  // A) Adı düzelt: aynı firmanın görünen adı. Kimlik (id), operasyon etiketi (subcon_name), iş etiketleri ve hakediş eşleşmeleri değişmez.
  // B) Resmi unvan değişikliği: aynı tüzel kişinin unvanı — ayrı işlem tipi (UNVAN), belge/gerekçe ile izlenir.
  app.put("/org/firma/:id", yonetKapisi, async (req, res) => {
    try {
      if (!firmaIslemiKapsamda(req)) return hata(res, 403, "Taşeron firma kaydı yalnız ana firma tarafından değiştirilir");
      const f = await firmaOku(req.params.id);
      if (!f) return hata(res, 404, "Firma bulunamadı");
      const islem = String(req.body?.islem || "");
      const gerekce = temiz(req.body?.gerekce, 500);
      if (!gerekce) return hata(res, 400, "Gerekçe yazın");
      if (islem === "ad_duzelt") {
        const yeni = temiz(req.body?.gorunen_ad, 120);
        if (yeni.length < 2) return hata(res, 400, "Yeni görünen ad gerekli");
        const m = await firmaMukerrer(yeni, f.id);
        if (m.ayni.length) return hata(res, 409, `"${yeni}" başka bir firmanın adı: ${m.ayni.map((x) => x.ad).join(", ")}. Farklı bir firmaysa "Yeni firmayla çalış" kullanın.`, { mevcut: m.ayni });
        await pool.query(`UPDATE subcons SET gorunen_ad=$2 WHERE id=$1`, [f.id, yeni]);
        await islemGecmisiYaz(req, "firma", f.id, "AD_DUZELT", { ad: firmaGorunen(f) }, { ad: yeni }, gerekce);
        return res.json({ ok: true, firma: await firmaOku(f.id) });
      }
      if (islem === "unvan") {
        const yeni = temiz(req.body?.unvan, 300);
        if (yeni.length < 2) return hata(res, 400, "Yeni resmi unvan gerekli");
        const belge = temiz(req.body?.belge, 300);
        await pool.query(`UPDATE subcons SET unvan=$2 WHERE id=$1`, [f.id, yeni]);
        await islemGecmisiYaz(req, "firma", f.id, "UNVAN", { unvan: f.unvan || null }, { unvan: yeni, belge: belge || null, gecerlilik: tarihMi(req.body?.tarih) ? req.body.tarih : null }, gerekce);
        return res.json({ ok: true, firma: await firmaOku(f.id) });
      }
      hata(res, 400, "Geçersiz işlem");
    } catch (e) { console.error("[org/firma put]", e.message); hata(res, 500, "Firma güncellenemedi"); }
  });

  // Pasife alma önizlemesi: bağlı aktif ekipler, mevcut personel atamaları, açık / planlı iş atamaları, bağlı taşeron hesapları
  async function acikIsler({ taseronId, ekipNolar }) {
    const out = [];
    if (taseronId) {
      const r = await pool.query(`SELECT a.id, a.kategori, a.durum, a.site_codes, to_char(a.plan_tarihi,'YYYY-MM-DD') AS plan_tarihi FROM is_atama a
        WHERE a.taseron_id=$1 AND ${ACIK_IS_DURUM} ORDER BY a.plan_tarihi NULLS LAST, a.id`, [taseronId]).catch(() => ({ rows: [] }));
      out.push(...r.rows.map((x) => ({ ...x, kaynak: "firma" })));
    }
    if (ekipNolar?.length) {
      const em = await pool.query(`SELECT DISTINCT LOWER(TRIM(email)) AS e FROM personel WHERE TRIM(COALESCE(ekip_bilgisi,'')) = ANY($1::text[]) AND COALESCE(aktif,true) AND COALESCE(email,'')<>''`,
        [ekipNolar.map(String)]).catch(() => ({ rows: [] }));
      const mailler = em.rows.map((x) => x.e);
      if (mailler.length) {
        const r = await pool.query(`SELECT DISTINCT a.id, a.kategori, a.durum, a.site_codes, to_char(a.plan_tarihi,'YYYY-MM-DD') AS plan_tarihi FROM is_atama a,
            jsonb_array_elements(COALESCE(a.personeller,'[]'::jsonb)) k WHERE ${ACIK_IS_DURUM} AND LOWER(TRIM(k->>'email')) = ANY($1::text[])`, [mailler]).catch(() => ({ rows: [] }));
        for (const x of r.rows) if (!out.some((o) => o.id === x.id)) out.push({ ...x, kaynak: "ekip personeli" });
      }
      // 06.11.2026: doğrudan ekip kimliğine yazılmış atamalar (is_atama.ekip_no)
      const r2 = await pool.query(`SELECT a.id, a.kategori, a.durum, a.site_codes, to_char(a.plan_tarihi,'YYYY-MM-DD') AS plan_tarihi FROM is_atama a
        WHERE ${ACIK_IS_DURUM} AND a.ekip_no = ANY($1::int[])`, [ekipNolar.map(Number)]).catch(() => ({ rows: [] }));
      for (const x of r2.rows) if (!out.some((o) => o.id === x.id)) out.push({ ...x, kaynak: "ekip" });
    }
    return out;
  }
  app.get("/org/firma/:id/pasif-onizleme", yonetKapisi, async (req, res) => {
    try {
      if (!firmaIslemiKapsamda(req)) return hata(res, 403, "Yetkiniz yok");
      const f = await firmaOku(req.params.id);
      if (!f) return hata(res, 404, "Firma bulunamadı");
      const y = await yapiOku(req);
      const ekipler = y.ekipler.filter((e) => e.firma_id === f.id);
      const hesaplar = await pool.query(`SELECT id, name, email FROM users WHERE to_jsonb(users)->>'taseron_id' = $1 AND COALESCE(is_active,true)`, [String(f.id)]).catch(() => ({ rows: [] }));
      res.json({ ok: true, firma: { id: f.id, ad: firmaGorunen(f), aktif: f.aktif },
        aktif_ekipler: ekipler.filter((e) => e.aktif !== false).map((e) => ({ ekip_no: e.ekip_no, ad: e.ad, bolge: e.bolge, uye_sayisi: e.uye_sayisi })),
        personel: ekipler.flatMap((e) => e.uyeler.map((p) => ({ id: p.id, ad_soyad: p.ad_soyad, ekip_no: e.ekip_no, ekip_ad: e.ad }))),
        acik_isler: await acikIsler({ taseronId: f.id, ekipNolar: ekipler.map((e) => e.ekip_no) }),
        taseron_hesaplari: hesaplar.rows });
    } catch (e) { console.error("[org/firma onizleme]", e.message); hata(res, 500, "Önizleme alınamadı"); }
  });
  // Durum: { aktif, gerekce, onay:true, ekipleri_de:boolean } — mevcut işler / finans / belgeler değişmez, iptal edilmez
  async function firmaDurumYaz(db, req, f, aktif, gerekce, ekipleriDe) {
    await db.query(`UPDATE subcons SET aktif=$2 WHERE id=$1`, [f.id, aktif]);
    await islemGecmisiYaz(req, "firma", f.id, "DURUM", { durum: f.aktif !== false ? "Aktif" : "Pasif" }, { durum: aktif ? "Aktif" : "Pasif" }, gerekce);
    const etkilenen = [];
    if (!aktif && ekipleriDe) {
      const r = await db.query(`UPDATE ekipler SET aktif=false, updated_at=NOW() WHERE firma_id=$1 AND aktif IS DISTINCT FROM false RETURNING ekip_no`, [f.id]);
      for (const e of r.rows) { etkilenen.push(e.ekip_no); await islemGecmisiYaz(req, "ekip", e.ekip_no, "DURUM", { durum: "Aktif" }, { durum: "Pasif" }, `Firma pasife alındı: ${gerekce}`); }
    }
    return etkilenen;
  }
  app.post("/org/firma/:id/durum", yonetKapisi, async (req, res) => {
    try {
      if (!firmaIslemiKapsamda(req)) return hata(res, 403, "Yetkiniz yok");
      const f = await firmaOku(req.params.id);
      if (!f) return hata(res, 404, "Firma bulunamadı");
      const aktif = req.body?.aktif === true, gerekce = temiz(req.body?.gerekce, 500);
      if (typeof req.body?.aktif !== "boolean") return hata(res, 400, "aktif true/false olmalı");
      if (!gerekce) return hata(res, 400, "Gerekçe yazın");
      if (!aktif && req.body?.onay !== true) return hata(res, 400, "Pasife alma etkisini önizleyip onaylayın");
      if ((f.aktif !== false) === aktif) return res.json({ ok: true, degisiklik: false });
      const etkilenen = await firmaDurumYaz(pool, req, f, aktif, gerekce, !!req.body?.ekipleri_de);
      res.json({ ok: true, pasiflenen_ekipler: etkilenen });
    } catch (e) { console.error("[org/firma durum]", e.message); hata(res, 500, "Durum değiştirilemedi"); }
  });
  // B) Yeni firmayla çalış: eski firma adı DEĞİŞMEZ; eski firma (+ekipleri) isteğe bağlı pasife alınır, yeni firma ve
  // ekipleri ayrı kimlikle açılır. Eski işler, PR/PO, hakediş, fatura, ödeme ve personel geçmişi yeni firmaya AKTARILMAZ.
  app.post("/org/firma/:id/yeni-firma", yonetKapisi, async (req, res) => {
    const db = await pool.connect();
    try {
      if (!firmaIslemiKapsamda(req)) return hata(res, 403, "Yetkiniz yok");
      const eski = await firmaOku(req.params.id, db);
      if (!eski) return hata(res, 404, "Firma bulunamadı");
      const ad = temiz(req.body?.yeni_ad, 120), gerekce = temiz(req.body?.gerekce, 500);
      if (ad.length < 2) return hata(res, 400, "Yeni firma adı gerekli");
      if (!gerekce) return hata(res, 400, "Gerekçe yazın");
      const m = await firmaMukerrer(ad);
      if (m.ayni.length) return hata(res, 409, `"${ad}" zaten kayıtlı: ${m.ayni.map((x) => x.ad).join(", ")}`, { mevcut: m.ayni });
      const ekipler = (Array.isArray(req.body?.ekipler) ? req.body.ekipler : []).map((e) => ({ ad: temiz(e?.ad, 80), bolge: temiz(e?.bolge, 40) })).filter((e) => e.ad).slice(0, 20);
      const adlar = ekipler.map((e) => katla(e.ad));
      if (new Set(adlar).size !== adlar.length) return hata(res, 400, "Yeni ekip adları birbirinden farklı olmalı");
      await db.query("BEGIN");
      const yeni = await firmaOlustur(db, req, { ad, unvan: req.body?.yeni_unvan, gerekce: `${firmaGorunen(eski)} yerine çalışılacak firma — ${gerekce}` });
      const acilan = [];
      for (const e of ekipler) acilan.push(await ekipOlustur(db, req, { firma_id: yeni.id, ad: e.ad, bolge: e.bolge, gerekce: `${ad} ile çalışmaya başlandı` }));
      let pasiflenen = [];
      if (req.body?.eski_pasif === true && eski.aktif !== false)
        pasiflenen = await firmaDurumYaz(db, req, eski, false, `${ad} ile çalışmaya geçildi — ${gerekce}`, req.body?.eski_ekipler_pasif !== false);
      await islemGecmisiYaz(req, "firma", eski.id, "YENI_FIRMA", null, { yeni_firma: ad, yeni_firma_id: yeni.id }, `Eski firmanın adı ve geçmiş kayıtları değiştirilmedi — ${gerekce}`);
      await db.query("COMMIT");
      res.json({ ok: true, yeni_firma: yeni, ekipler: acilan, pasiflenen_ekipler: pasiflenen });
    } catch (e) {
      await db.query("ROLLBACK").catch(() => {});
      console.error("[org/yeni-firma]", e.message); hata(res, e.kullanici ? 409 : 500, e.kullanici ? e.message : "İşlem tamamlanamadı");
    } finally { db.release(); }
  });
  // Silme: yalnız bu ekrandan açılmış, hiç kullanılmamış (ekip, kullanıcı, iş, iş kaydı, personel, fatura bağı yok) hatalı kayıt
  app.delete("/org/firma/:id", silKapisi, async (req, res) => {
    try {
      if (!firmaIslemiKapsamda(req)) return hata(res, 403, "Yetkiniz yok");
      const f = await firmaOku(req.params.id);
      if (!f) return hata(res, 404, "Firma bulunamadı");
      if (f.kaynak !== "ORG") return hata(res, 409, "Bu firma iş kayıtlarından gelen bir kayıttır — silinemez, pasife alın");
      const say = async (sql, p) => Number((await pool.query(sql, p).catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n || 0);
      const n = await say(`SELECT COUNT(*) n FROM ekipler WHERE firma_id=$1`, [f.id]) + await say(`SELECT COUNT(*) n FROM is_atama WHERE taseron_id=$1`, [f.id])
        + await say(`SELECT COUNT(*) n FROM users WHERE to_jsonb(users)->>'taseron_id' = $1`, [String(f.id)])
        + await say(`SELECT COUNT(*) n FROM master_works WHERE UPPER(TRIM(subcon_name)) = UPPER(TRIM($1))`, [f.subcon_name])
        + await say(`SELECT COUNT(*) n FROM personel WHERE UPPER(TRIM(COALESCE(alt_yuklenici,''))) = UPPER(TRIM($1))`, [f.subcon_name])
        + await say(`SELECT COUNT(*) n FROM subcon_takma_ad WHERE subcon_id=$1`, [f.id]);
      if (n) return hata(res, 409, "Firma kullanılmış (ekip, iş, kullanıcı ya da kayıt bağlı) — silinemez, pasife alın");
      await islemGecmisiYaz(req, "firma", f.id, "SILME", { ad: firmaGorunen(f) }, null, temiz(req.body?.gerekce, 500) || "Hatalı kayıt");
      await pool.query(`DELETE FROM subcons WHERE id=$1`, [f.id]);
      res.json({ ok: true });
    } catch (e) { console.error("[org/firma sil]", e.message); hata(res, 500, "Silinemedi"); }
  });

  // ── EKİP ────────────────────────────────────────────────────────────────────────────────────────────────────
  // Mesajlarda ekip "Firma — Ekip adı" olarak anılır (ekranlardaki ad kuralıyla aynı; TEKNO ekip adı kendi başına tam addır)
  async function ekipTamAd(e) {
    const ad = e.ad || `Ekip ${e.ekip_no}`;
    if (/^TEKNO\b/i.test(ad) || ekipTuru(e) === "IC") return ad; // iç ekibin adı kendi başına tam addır
    const f = e.firma_id ? firmaGorunen(await firmaOku(e.firma_id)) : temiz(e.taseron_adi);
    return f && katla(f) !== katla(ad) ? `${f} — ${ad}` : ad;     // firma = ekip adıysa tekrar yazılmaz
  }
  const kullaniciHatasi = (m) => Object.assign(new Error(m), { kullanici: true });
  async function ekipAdMukerrer(db, { firma_id, bagli_firma, taseron_adi, ad }, haricNo) {
    // Birleştirilmiş mükerrer kayıtlar ad çakışmasına sayılmaz (adları hedef ekipte yaşamaya devam eder)
    const r = await db.query(`SELECT ekip_no, ad, firma_id, bagli_firma, ekip_turu, taseron_adi FROM ekipler WHERE ekip_no <> $1 AND birlesen_ekip_no IS NULL`, [Number(haricNo) || 0]);
    const k = katla(ad);
    return r.rows.find((e) => katla(e.ad) === k && (firma_id ? e.firma_id === firma_id
      : bagli_firma ? e.ekip_turu === "IC" && String(e.bagli_firma || "").toUpperCase() === bagli_firma
        : !e.firma_id && katla(e.taseron_adi) === katla(taseron_adi))) || null;
  }
  // Tür açıkça seçilir (06.11.2026): firma kartı varsa TAŞERON ekibi (DIS), yoksa İÇ ekip (IC). Taşeron ekibinde
  // operasyon_firma = ekibin çalıştığı operasyonu yöneten firma (ERC / TEKNO …) — taşeronun hukuki kimliği firma kartında kalır.
  async function ekipOlustur(db, req, { firma_id, bagli_firma, operasyon_firma, operasyon_bas, ad, bolge, aciklama, gerekce }) {
    ad = temiz(ad, 80); bolge = temiz(bolge, 40); bagli_firma = bagli_firma ? String(bagli_firma).toUpperCase() : null;
    operasyon_firma = operasyon_firma ? String(operasyon_firma).trim().toUpperCase() : null;
    if (ad.length < 1) throw kullaniciHatasi("Ekip adı gerekli");
    let firma = null;
    if (firma_id) {
      firma = await firmaOku(firma_id, db);
      if (!firma) throw kullaniciHatasi("Firma bulunamadı");
      if (firma.aktif === false) throw kullaniciHatasi(`${firmaGorunen(firma)} pasif — pasif firmaya yeni ekip açılamaz`);
    } else if (!bagli_firma) throw kullaniciHatasi("Firma seçin");
    const kodlar = await markaKodlari();
    const op = firma ? operasyon_firma : bagli_firma;
    if (op && !kodlar.has(op)) throw kullaniciHatasi(`Geçersiz firma: ${op}`);
    const ayni = await ekipAdMukerrer(db, { firma_id: firma?.id, bagli_firma: firma ? null : bagli_firma, ad });
    if (ayni) throw kullaniciHatasi(`Bu firmada "${ayni.ad}" adlı bir ekip zaten var (Ekip ${ayni.ekip_no})`);
    const no = (await db.query(`SELECT COALESCE(MAX(ekip_no),0)+1 AS n FROM ekipler`)).rows[0].n;
    const r = await db.query(`INSERT INTO ekipler (ekip_no, ad, bolge, aciklama, firma_id, taseron_adi, ekip_turu, bagli_firma, operasyon_bas, aktif)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) RETURNING *`,
      [no, ad, bolge || null, temiz(aciklama, 500) || null, firma?.id || null, firma ? firmaGorunen(firma) : null, firma ? "DIS" : "IC", op || null,
        firma && op ? (tarihMi(operasyon_bas) ? operasyon_bas : bugun()) : null]);
    await islemGecmisiYaz(req, "ekip", no, "OLUSTURMA", null, { ad, tur: firma ? "Taşeron ekibi" : "İç ekip", firma: firma ? firmaGorunen(firma) : bagli_firma,
      operasyon: firma ? (op ? kodlar.get(op) : null) : undefined, bolge: bolge || null, durum: "Aktif" }, gerekce || null);
    degisti();
    return r.rows[0];
  }
  app.post("/org/ekip", yonetKapisi, async (req, res) => {
    try {
      const b = req.body || {};
      const m = orgYetki(req).marka;
      if (m && (b.firma_id || String(b.bagli_firma || "").toUpperCase() !== m)) return hata(res, 403, "Yalnız kendi firmanızın ekibini açabilirsiniz");
      if (b.bolge && !BOLGELER.includes(temiz(b.bolge))) return hata(res, 400, "Geçersiz bölge");
      // Tür gönderildiyse seçimle tutarlı olmalı: iç ekip firma kartına, taşeron ekibi markaya bağlanmaz
      const tur = String(b.tur || "").toUpperCase();
      if (tur === "IC" && b.firma_id) return hata(res, 400, "İç ekip taşeron firma kartına bağlanamaz");
      if (tur === "DIS" && !Number(b.firma_id)) return hata(res, 400, "Taşeron ekibi için taşeron firmayı seçin");
      const e = await ekipOlustur(pool, req, { firma_id: Number(b.firma_id) || null, bagli_firma: b.bagli_firma, operasyon_firma: b.operasyon_firma, operasyon_bas: b.operasyon_bas,
        ad: b.ad, bolge: b.bolge, aciklama: b.aciklama, gerekce: temiz(b.gerekce, 500) });
      res.json({ ok: true, ekip: e });
    } catch (e) { if (e.kullanici) return hata(res, 409, e.message); console.error("[org/ekip]", e.message); hata(res, 500, "Ekip açılamadı"); }
  });
  // Düzenle: ad, firma bağlantısı, bölge, açıklama (ayrı alanlar). Firma bağlantısı değişince eski ekip adı / iş etiketleri korunur.
  app.put("/org/ekip/:no", yonetKapisi, async (req, res) => {
    try {
      const e = await ekipOku(req.params.no);
      if (!e) return hata(res, 404, "Ekip bulunamadı");
      if (!ekipKapsamda(req, e)) return hata(res, 403, "Bu ekip firmanızın kapsamında değil");
      const b = req.body || {};
      const yeni = {
        ad: "ad" in b ? temiz(b.ad, 80) : e.ad,
        bolge: "bolge" in b ? (temiz(b.bolge, 40) || null) : e.bolge,
        aciklama: "aciklama" in b ? (temiz(b.aciklama, 500) || null) : e.aciklama,
        firma_id: "firma_id" in b ? (Number(b.firma_id) || null) : e.firma_id,
      };
      if (!yeni.ad) return hata(res, 400, "Ekip adı boş olamaz");
      if (yeni.bolge && !BOLGELER.includes(yeni.bolge) && yeni.bolge !== e.bolge) return hata(res, 400, "Geçersiz bölge");
      if (yeni.firma_id !== e.firma_id && orgYetki(req).marka) return hata(res, 403, "Firma bağlantısını değiştiremezsiniz");
      let firma = null;
      if (yeni.firma_id) {
        firma = await firmaOku(yeni.firma_id);
        if (!firma) return hata(res, 404, "Firma bulunamadı");
        if (yeni.firma_id !== e.firma_id && firma.aktif === false) return hata(res, 409, `${firmaGorunen(firma)} pasif — pasif firmaya ekip bağlanamaz`);
      }
      const ayni = await ekipAdMukerrer(pool, { firma_id: yeni.firma_id, bagli_firma: !yeni.firma_id && e.ekip_turu === "IC" ? String(e.bagli_firma || "").toUpperCase() : null, taseron_adi: e.taseron_adi, ad: yeni.ad }, e.ekip_no);
      if (ayni) return hata(res, 409, `Bu firmada "${ayni.ad}" adlı bir ekip zaten var (Ekip ${ayni.ekip_no})`);
      const gerekce = temiz(b.gerekce, 500);
      const eskiFirma = e.firma_id ? await firmaOku(e.firma_id) : null;
      const eskiOz = { ad: e.ad, bolge: e.bolge, aciklama: e.aciklama, firma: eskiFirma ? firmaGorunen(eskiFirma) : (e.taseron_adi || null) };
      const yeniOz = { ad: yeni.ad, bolge: yeni.bolge, aciklama: yeni.aciklama, firma: firma ? firmaGorunen(firma) : (e.taseron_adi || null) };
      if (JSON.stringify(eskiOz) === JSON.stringify(yeniOz)) return res.json({ ok: true, degisiklik: false });
      if (yeni.firma_id !== e.firma_id && !gerekce) return hata(res, 400, "Firma bağlantısı değişikliği için gerekçe yazın");
      // Firmaya ilk bağlanan eski ekip dış taşeron sayılır (türü boşsa); kendi ekibi (IC) türü korunur
      const tur = yeni.firma_id && !e.ekip_turu ? "DIS" : e.ekip_turu;
      // Ad gösterim alanıdır: kimlik (ekip_no) ve bağlantılar değişmez; önceki ad eski_adlar'da izlenir (geçmiş kayıtlarda aranabilir)
      // (yalnız Türkçe harf düzeltmesi de — ör. TETIK → TETİK — eski yazımıyla izlenir: iş kayıtlarındaki etiket eski yazımda olabilir)
      const eskiAdlar = yeni.ad !== temiz(e.ad) && e.ad ? [...new Set([...(e.eski_adlar || []), e.ad])].filter((a) => temiz(a) !== yeni.ad) : (e.eski_adlar || []);
      const r = await pool.query(`UPDATE ekipler SET ad=$2, bolge=$3, aciklama=$4, firma_id=$5, ekip_turu=$6, eski_adlar=$7, updated_at=NOW() WHERE ekip_no=$1 RETURNING *`,
        [e.ekip_no, yeni.ad, yeni.bolge, yeni.aciklama, yeni.firma_id, tur, eskiAdlar]);
      await islemGecmisiYaz(req, "ekip", e.ekip_no, "DUZENLEME", eskiOz, yeniOz, gerekce || null);
      degisti();
      res.json({ ok: true, ekip: r.rows[0] });
    } catch (e) { console.error("[org/ekip put]", e.message); hata(res, 500, "Ekip güncellenemedi"); }
  });
  app.get("/org/ekip/:no/pasif-onizleme", yonetKapisi, async (req, res) => {
    try {
      const y = await yapiOku(req);
      const e = y.ekipler.find((x) => x.ekip_no === Number(req.params.no));
      if (!e) return hata(res, 404, "Ekip bulunamadı");
      res.json({ ok: true, ekip: { ekip_no: e.ekip_no, ad: e.ad, aktif: e.aktif !== false },
        personel: e.uyeler.map((p) => ({ id: p.id, ad_soyad: p.ad_soyad })), acik_isler: await acikIsler({ ekipNolar: [e.ekip_no] }) });
    } catch (e) { hata(res, 500, "Önizleme alınamadı"); }
  });
  app.post("/org/ekip/:no/durum", yonetKapisi, async (req, res) => {
    try {
      const e = await ekipOku(req.params.no);
      if (!e) return hata(res, 404, "Ekip bulunamadı");
      if (!ekipKapsamda(req, e)) return hata(res, 403, "Bu ekip firmanızın kapsamında değil");
      if (typeof req.body?.aktif !== "boolean") return hata(res, 400, "aktif true/false olmalı");
      const aktif = req.body.aktif, gerekce = temiz(req.body?.gerekce, 500);
      if (!gerekce) return hata(res, 400, "Gerekçe yazın");
      if (!aktif && req.body?.onay !== true) return hata(res, 400, "Pasife alma etkisini önizleyip onaylayın");
      if (aktif && e.firma_id) { const f = await firmaOku(e.firma_id); if (f && f.aktif === false) return hata(res, 409, `${firmaGorunen(f)} pasif — önce firmayı aktif edin`); }
      if (aktif && ekipBirlesmis(e)) return hata(res, 409, `Bu kayıt Ekip ${e.birlesen_ekip_no} ile birleştirilmiş — aktif edilemez (gerekirse birleştirmeyi geri alın)`);
      if ((e.aktif !== false) === aktif) return res.json({ ok: true, degisiklik: false });
      await pool.query(`UPDATE ekipler SET aktif=$2, updated_at=NOW() WHERE ekip_no=$1`, [e.ekip_no, aktif]);
      degisti();
      await islemGecmisiYaz(req, "ekip", e.ekip_no, "DURUM", { durum: e.aktif !== false ? "Aktif" : "Pasif" }, { durum: aktif ? "Aktif" : "Pasif" }, gerekce);
      res.json({ ok: true });
    } catch (e) { console.error("[org/ekip durum]", e.message); hata(res, 500, "Durum değiştirilemedi"); }
  });
  app.put("/org/ekip/:no/sef", yonetKapisi, async (req, res) => {
    try {
      const e = await ekipOku(req.params.no);
      if (!e) return hata(res, 404, "Ekip bulunamadı");
      if (!ekipKapsamda(req, e)) return hata(res, 403, "Bu ekip firmanızın kapsamında değil");
      const pid = req.body?.personel_id ? Number(req.body.personel_id) : null;
      const uyeler = (await uyeleriOku()).filter((p) => String(p.ekip_bilgisi).trim() === String(e.ekip_no));
      const yeni = pid ? uyeler.find((p) => p.id === pid) : null;
      if (pid && !yeni) return hata(res, 409, "Şef olarak yalnız bu ekibin güncel üyesi seçilebilir");
      const eski = e.sef_personel_id ? uyeler.find((p) => p.id === e.sef_personel_id) || { ad_soyad: `#${e.sef_personel_id}` } : null;
      await pool.query(`UPDATE ekipler SET sef_personel_id=$2, updated_at=NOW() WHERE ekip_no=$1`, [e.ekip_no, pid]);
      await islemGecmisiYaz(req, "ekip", e.ekip_no, "SEF", { sef: eski?.ad_soyad || null }, { sef: yeni?.ad_soyad || null }, temiz(req.body?.gerekce, 500) || null);
      res.json({ ok: true });
    } catch (e) { console.error("[org/sef]", e.message); hata(res, 500, "Şef değiştirilemedi"); }
  });

  // ── ÜYELİK ──────────────────────────────────────────────────────────────────────────────────────────────────
  // Açık üyelik satırı yoksa (bu sistemden önceki atama) başlangıcı bilinmeyen bir satır açılır — geçmiş uydurulmaz.
  async function acikUyelik(db, personelId, ekipNo) {
    const r = await db.query(`SELECT * FROM ekip_uyelik WHERE personel_id=$1 AND bitis IS NULL`, [personelId]);
    if (r.rows[0]) return r.rows[0];
    if (!ekipNo) return null;
    const ins = await db.query(`INSERT INTO ekip_uyelik (personel_id, ekip_no, baslangic, baslatan, baslangic_gerekce)
      VALUES ($1,$2,NULL,NULL,'Bu kayıttan önceki atama (başlangıç tarihi bilinmiyor)') RETURNING *`, [personelId, Number(ekipNo)]);
    return ins.rows[0];
  }
  async function uyelikBitir(db, req, p, { tarih, gerekce, tip }) {
    const eskiNo = Number(String(p.ekip_bilgisi || "").trim()) || null;
    if (!eskiNo) return null;
    const u = await acikUyelik(db, p.id, eskiNo);
    if (u) await db.query(`UPDATE ekip_uyelik SET bitis=$2, bitiren=$3, bitis_gerekce=$4, updated_at=NOW() WHERE id=$1`, [u.id, tarih, kim(req), gerekce || null]);
    // Ekip şefi ayrılırsa şef kaydı bırakılır (kişi artık üye değil) → kartta kalıcı "Ekip şefi ayrıldı — yeni şef seçin" uyarısı
    const sq = await db.query(`SELECT ekip_no FROM ekipler WHERE ekip_no=$1 AND sef_personel_id=$2`, [eskiNo, p.id]);
    await islemGecmisiYaz(req, "ekip", eskiNo, tip || "UYE_CIKAR", { uye: p.ad_soyad }, { bitis: tarih, ...(sq.rows.length ? { sef: "— (şef ayrıldı)" } : {}) }, gerekce || null);
    return { ekip_no: eskiNo, sef_ayrildi: sq.rows.length > 0 };
  }
  // Araç ataması kişiye yazılıdır; ekipten çıkınca mevcut kuraldaki gibi araç bağı da çözülür (araç kartı sürücüsü temizlenir)
  async function aracBagiCoz(db, p) {
    if (!p.ekip_arac_plaka) return;
    await db.query(`UPDATE personel SET ekip_arac_plaka=NULL WHERE id=$1`, [p.id]);
    await db.query(`UPDATE araclar SET surucu=NULL WHERE plaka=$1 AND surucu=$2`, [p.ekip_arac_plaka, p.ad_soyad]).catch(() => {});
  }
  // Ekleme / taşıma: { personel_id, baslangic?, gerekce?, tasima_onayi?, firma_farki_onayi? }
  app.post("/org/ekip/:no/uye", yonetKapisi, async (req, res) => {
    const db = await pool.connect();
    try {
      const e = await ekipOku(req.params.no, db);
      if (!e) return hata(res, 404, "Ekip bulunamadı");
      if (!ekipKapsamda(req, e)) return hata(res, 403, "Bu ekip firmanızın kapsamında değil");
      if (e.aktif === false) return hata(res, 409, "Ekip pasif — pasif ekibe personel eklenemez");
      const firma = e.firma_id ? await firmaOku(e.firma_id, db) : null;
      if (firma && firma.aktif === false) return hata(res, 409, `${firmaGorunen(firma)} pasif — pasif firmanın ekibine personel eklenemez`);
      const pid = Number(req.body?.personel_id);
      const p = (await db.query(`SELECT id, ad_soyad, aktif, ekip_bilgisi, ekip_arac_plaka, COALESCE(firma_tipi,'simsek') AS firma_tipi, alt_yuklenici, COALESCE(marka,'ERC') AS marka,
          (isten_ayrilma_tarihi IS NOT NULL AND isten_ayrilma_tarihi <= CURRENT_DATE) AS ayrildi FROM personel WHERE id=$1`, [pid])).rows[0];
      if (!p) return hata(res, 404, "Personel bulunamadı");
      if (p.aktif === false || p.ayrildi) return hata(res, 409, `${p.ad_soyad} aktif çalışan değil`);
      const m = orgYetki(req).marka;
      if (m && String(p.marka).toUpperCase() !== m && !(m === "TEKNO" && String(p.marka).toUpperCase() === "AHY")) return hata(res, 403, "Bu personel firmanızın kapsamında değil");
      const mevcutNo = String(p.ekip_bilgisi || "").trim();
      if (mevcutNo === String(e.ekip_no)) return res.json({ ok: true, degisiklik: false });
      const tarih = tarihMi(req.body?.baslangic) ? req.body.baslangic : bugun();
      const gerekce = temiz(req.body?.gerekce, 500);
      // Çakışma: kişi başka bir ekipteyse sessizce taşınmaz — mevcut atama gösterilir, açık onay istenir
      if (mevcutNo) {
        const diger = await ekipOku(mevcutNo, db);
        if (req.body?.tasima_onayi !== true)
          return hata(res, 409, `${p.ad_soyad} şu an ${diger ? await ekipTamAd(diger) : `Ekip ${mevcutNo}`} ekibinde. Taşımak için onaylayın.`,
            { cakisma: { ekip_no: Number(mevcutNo), ad: diger?.ad || null, sef_mi: diger?.sef_personel_id === p.id } });
        if (diger && !ekipKapsamda(req, diger)) return hata(res, 403, "Kişinin mevcut ekibi firmanızın kapsamında değil");
      }
      // Firma farkı: taşeron personelinin kayıtlı firması ekibin firmasından farklıysa uyarı (firma değişikliği ayrı İK işlemidir)
      if (firma && p.firma_tipi === "taseron" && katla(p.alt_yuklenici) && ![firma.subcon_name, firma.gorunen_ad, firma.unvan].map(katla).includes(katla(p.alt_yuklenici))
        && req.body?.firma_farki_onayi !== true)
        return hata(res, 409, `${p.ad_soyad} kayıtlarda "${p.alt_yuklenici}" firmasının personeli; ekip ${firmaGorunen(firma)} firmasına bağlı. Personelin firması bu işlemle değişmez — yine de eklemek için onaylayın.`, { firma_farki: { personel_firma: p.alt_yuklenici, ekip_firma: firmaGorunen(firma) } });
      await db.query("BEGIN");
      let eskiBilgi = null;
      if (mevcutNo) { eskiBilgi = await uyelikBitir(db, req, p, { tarih, gerekce: gerekce || `Ekip ${e.ekip_no} ekibine taşındı`, tip: "UYE_TASI_CIKIS" }); await aracBagiCoz(db, p); }
      await db.query(`UPDATE personel SET ekip_bilgisi=$2 WHERE id=$1`, [p.id, String(e.ekip_no)]);
      await db.query(`INSERT INTO ekip_uyelik (personel_id, ekip_no, baslangic, baslatan, baslangic_gerekce) VALUES ($1,$2,$3,$4,$5)`, [p.id, e.ekip_no, tarih, kim(req), gerekce || null]);
      await islemGecmisiYaz(req, "ekip", e.ekip_no, mevcutNo ? "UYE_TASI_GIRIS" : "UYE_EKLE", mevcutNo ? { onceki_ekip: `Ekip ${mevcutNo}` } : null, { uye: p.ad_soyad, baslangic: tarih }, gerekce || null);
      await db.query("COMMIT");
      res.json({ ok: true, onceki: eskiBilgi });
    } catch (err) { await db.query("ROLLBACK").catch(() => {}); console.error("[org/uye]", err.message); hata(res, 500, "Personel eklenemedi"); }
    finally { db.release(); }
  });
  // Ekipten çıkar: personel silinmez; özlük, İSG, eğitim, puantaj ve geçmiş ekip kayıtları korunur, yalnız üyelik biter
  app.post("/org/ekip/:no/uye/:pid/cikar", yonetKapisi, async (req, res) => {
    const db = await pool.connect();
    try {
      const e = await ekipOku(req.params.no, db);
      if (!e) return hata(res, 404, "Ekip bulunamadı");
      if (!ekipKapsamda(req, e)) return hata(res, 403, "Bu ekip firmanızın kapsamında değil");
      const p = (await db.query(`SELECT id, ad_soyad, ekip_bilgisi, ekip_arac_plaka FROM personel WHERE id=$1`, [Number(req.params.pid)])).rows[0];
      if (!p || String(p.ekip_bilgisi || "").trim() !== String(e.ekip_no)) return hata(res, 409, "Kişi bu ekibin güncel üyesi değil");
      const gerekce = temiz(req.body?.gerekce, 500);
      if (!gerekce) return hata(res, 400, "Gerekçe yazın");
      const tarih = tarihMi(req.body?.bitis) ? req.body.bitis : bugun();
      await db.query("BEGIN");
      const s = await uyelikBitir(db, req, p, { tarih, gerekce, tip: "UYE_CIKAR" });
      await aracBagiCoz(db, p);
      await db.query(`UPDATE personel SET ekip_bilgisi=NULL WHERE id=$1`, [p.id]);
      await db.query("COMMIT");
      res.json({ ok: true, sef_gerekli: !!s?.sef_ayrildi });
    } catch (err) { await db.query("ROLLBACK").catch(() => {}); console.error("[org/cikar]", err.message); hata(res, 500, "Çıkarılamadı"); }
    finally { db.release(); }
  });
  // Personel seçimi (yalnız ad / ünvan / firma / güncel ekip — maaş, kimlik, banka alanı yok)
  app.get("/org/personel-secim", yonetKapisi, async (req, res) => {
    try {
      const m = orgYetki(req).marka;
      const r = await pool.query(`SELECT p.id, p.ad_soyad, p.unvan, COALESCE(p.firma_tipi,'simsek') AS firma_tipi, p.alt_yuklenici, COALESCE(p.marka,'ERC') AS marka,
          NULLIF(TRIM(COALESCE(p.ekip_bilgisi,'')),'') AS ekip_no
        FROM personel p WHERE COALESCE(p.aktif,true) AND (p.isten_ayrilma_tarihi IS NULL OR p.isten_ayrilma_tarihi > CURRENT_DATE)
        ORDER BY p.ad_soyad`);
      res.json({ ok: true, personel: m ? r.rows.filter((p) => String(p.marka).toUpperCase() === m || (m === "TEKNO" && String(p.marka).toUpperCase() === "AHY")) : r.rows });
    } catch (e) { hata(res, 500, "Personel listesi alınamadı"); }
  });
  app.get("/org/personel/:id/uyelikler", gorKapisi, async (req, res) => {
    try {
      const r = await pool.query(`SELECT u.id, u.ekip_no, e.ad AS ekip_ad, to_char(u.baslangic,'YYYY-MM-DD') AS baslangic, to_char(u.bitis,'YYYY-MM-DD') AS bitis,
          u.baslatan, u.bitiren, u.baslangic_gerekce, u.bitis_gerekce FROM ekip_uyelik u LEFT JOIN ekipler e ON e.ekip_no=u.ekip_no
        WHERE u.personel_id=$1 ORDER BY u.id`, [Number(req.params.id)]);
      res.json({ ok: true, uyelikler: r.rows });
    } catch (e) { hata(res, 500, "Üyelik geçmişi alınamadı"); }
  });

  // ── MÜKERRER EKİP BİRLEŞTİRME (06.11.2026) ──────────────────────────────────────────────────────────────────
  // Önizleme → onay → uygulama; her adım işlem geçmişine yazılır ve geri alınabilir. Kayıt silinmez. Yapısal işlem: org_sil ister.
  const planOzet = (p) => ({ uygun: p.uygun, engeller: p.engeller,
    kaynak: p.kaynak && { ekip_no: p.kaynak.ekip_no, ad: p.kaynak.ad, is_etiketleri: p.kaynak.is_etiketleri || [], baglanti: p.kaynak_baglanti },
    hedef: p.hedef && { ekip_no: p.hedef.ekip_no, ad: p.hedef.ad, is_etiketleri: p.hedef.is_etiketleri || [], baglanti: p.hedef_baglanti },
    etiket_is: p.etiket_is, sonuc: p.sonuc });
  app.get("/org/ekip/:no/birlestir-onizleme", silKapisi, async (req, res) => {
    try {
      const p = await birlestirPlan(pool, req.params.no, req.query.hedef, { ad: req.query.ad });
      if ((p.kaynak && !ekipKapsamda(req, p.kaynak)) || (p.hedef && !ekipKapsamda(req, p.hedef))) return hata(res, 403, "Bu ekip firmanızın kapsamında değil");
      res.json({ ok: true, ...planOzet(p) });
    } catch (e) { console.error("[org/birlestir önizleme]", e.message); hata(res, 500, "Önizleme alınamadı"); }
  });
  app.post("/org/ekip/:no/birlestir", silKapisi, async (req, res) => {
    const db = await pool.connect();
    try {
      const gerekce = temiz(req.body?.gerekce, 500);
      if (!gerekce) return hata(res, 400, "Gerekçe yazın");
      if (req.body?.onay !== true) return hata(res, 400, "Birleştirme etkisini önizleyip onaylayın");
      await db.query("BEGIN");
      const p = await birlestirPlan(db, req.params.no, req.body?.hedef_no, { ad: req.body?.ad });
      if ((p.kaynak && !ekipKapsamda(req, p.kaynak)) || (p.hedef && !ekipKapsamda(req, p.hedef))) { await db.query("ROLLBACK"); return hata(res, 403, "Bu ekip firmanızın kapsamında değil"); }
      if (!p.uygun) { await db.query("ROLLBACK"); return hata(res, 409, p.engeller.join(" · "), { engeller: p.engeller }); }
      const s = await birlestirUygula(db, p, yaz(req), gerekce);
      await db.query("COMMIT");
      degisti();
      res.json({ ok: true, sonuc: s });
    } catch (e) { await db.query("ROLLBACK").catch(() => {}); if (e.kullanici) return hata(res, 409, e.message); console.error("[org/birlestir]", e.message); hata(res, 500, "Birleştirilemedi"); }
    finally { db.release(); }
  });
  app.post("/org/ekip/:no/birlestir-geri-al", silKapisi, async (req, res) => {
    const db = await pool.connect();
    try {
      const gerekce = temiz(req.body?.gerekce, 500);
      if (!gerekce) return hata(res, 400, "Gerekçe yazın");
      const e = await ekipOku(req.params.no, db);
      if (!e) return hata(res, 404, "Ekip bulunamadı");
      if (!ekipKapsamda(req, e)) return hata(res, 403, "Bu ekip firmanızın kapsamında değil");
      await db.query("BEGIN");
      const s = await birlestirGeriAl(db, e.ekip_no, yaz(req), gerekce);
      await db.query("COMMIT");
      degisti();
      res.json({ ok: true, ...s });
    } catch (err) { await db.query("ROLLBACK").catch(() => {}); if (err.kullanici) return hata(res, 409, err.message); console.error("[org/birlestir geri]", err.message); hata(res, 500, "Geri alınamadı"); }
    finally { db.release(); }
  });

  // ── OPERASYON BAĞLANTISI (06.11.2026) ───────────────────────────────────────────────────────────────────────
  // "Taşeronu operasyondan çıkar" taşeron FİRMA kartını (hukuki kimlik, cari, fatura, hakediş) SİLMEZ ve pasife almaz:
  // yalnız o EKİBİN (firma + bölge) operasyon bağlantısı tarihli sona erer. Firmanın başka bölgedeki ekipleri etkilenmez.
  // Açık iş ya da ekipte duran malzeme varken çıkarılmaz (kayıt sahipsiz kalmasın); araç tahsisleri aynı tarihte kapanır.
  async function ekipMalzemeBakiye(no) {
    try {
      if (!(await tabloVar("hw_malzeme_islem")) || !(await tabloVar("hw_malzeme_islem_kalem"))) return 0;
      const r = await pool.query(`SELECT COALESCE(SUM(CASE WHEN i.hedef_tip='EKIP' AND i.hedef_id=$1 THEN k.miktar ELSE 0 END)
          - SUM(CASE WHEN i.kaynak_tip='EKIP' AND i.kaynak_id=$1 THEN k.miktar ELSE 0 END),0) AS n
        FROM hw_malzeme_islem i JOIN hw_malzeme_islem_kalem k ON k.islem_id=i.id
        WHERE i.ters_islem_id IS NULL AND i.ters_edilen_id IS NULL AND ((i.hedef_tip='EKIP' AND i.hedef_id=$1) OR (i.kaynak_tip='EKIP' AND i.kaynak_id=$1))`, [String(no)]);
      return Number(r.rows[0]?.n || 0);
    } catch (e) { console.error("[org malzeme]", e.message); return null; }
  }
  async function ekipTahsisleri(no, uyeIdleri = [], db = pool) {
    if (!(await tabloVar("arac_tahsis", db))) return [];
    return (await db.query(`SELECT id, arac_id, plaka, personel_id, ekip_no, bas::text AS bas, bit::text AS bit FROM arac_tahsis
      WHERE NOT iptal AND (bit IS NULL OR bit >= CURRENT_DATE) AND (ekip_no=$1 OR personel_id = ANY($2::int[])) ORDER BY bas`, [Number(no), uyeIdleri])).rows.map((t) => ({ ...t, id: Number(t.id) }));
  }
  async function operasyonEtkisi(req, no) {
    const y = await yapiOku(req);
    const e = y.ekipler.find((x) => x.ekip_no === Number(no));
    if (!e) return null;
    const hesap = await pool.query(`SELECT u.user_id, us.name, u.rol FROM taseron_saha_uye u JOIN users us ON us.id=u.user_id WHERE u.ekip_no=$1 AND COALESCE(u.aktif,true)`, [e.ekip_no]).catch(() => ({ rows: [] }));
    const malzeme = await ekipMalzemeBakiye(e.ekip_no);
    return { e, etki: {
      ekip: { ekip_no: e.ekip_no, ad: e.ad, tur: e.tur, tur_ad: e.tur_ad, bolge: e.bolge || null, aktif: e.aktif !== false, operasyon_ad: e.operasyon_ad, firma: e.firma_gorunen },
      personel: e.uyeler.map((p) => ({ id: p.id, ad_soyad: p.ad_soyad })),
      // Taşeron firmaya (ekip belirtilmeden) atanmış açık işler: firmanın bu operasyonda başka aktif ekibi yoksa bu ekibin işidir
      acik_isler: await acikIsler({ ekipNolar: [e.ekip_no],
        taseronId: e.tur === "DIS" && e.firma_id && !y.ekipler.some((x) => x.firma_id === e.firma_id && x.ekip_no !== e.ekip_no && x.etkin && x.operasyon_firma === e.operasyon_firma) ? e.firma_id : null }),
      arac_tahsisleri: await ekipTahsisleri(e.ekip_no, e.uyeler.map((p) => p.id)),
      malzeme_bakiye: malzeme, malzeme_veri: malzeme == null ? "VERI_YOK" : "OK",
      taseron_hesaplari: hesap.rows,
      firma_diger_ekipler: e.firma_id ? y.ekipler.filter((x) => x.firma_id === e.firma_id && x.ekip_no !== e.ekip_no).map((x) => ({ ekip_no: x.ekip_no, ad: x.ad, bolge: x.bolge || null, aktif: x.aktif !== false })) : [],
    } };
  }
  app.get("/org/ekip/:no/operasyon-onizleme", yonetKapisi, async (req, res) => {
    try {
      const s = await operasyonEtkisi(req, req.params.no);
      if (!s) return hata(res, 404, "Ekip bulunamadı");
      const engeller = [];
      if (s.etki.acik_isler.length) engeller.push(`${s.etki.acik_isler.length} açık iş ataması var — önce başka ekibe devredin ya da kapatın`);
      if (s.etki.malzeme_bakiye == null) engeller.push("Ekipteki malzeme bakiyesi okunamadı — veri alınamadan çıkarma yapılmaz");
      else if (s.etki.malzeme_bakiye > 0) engeller.push("Ekipte teslim edilmiş malzeme duruyor — önce depoya dönüş ya da devir yapın");
      res.json({ ok: true, ...s.etki, engeller });
    } catch (e) { console.error("[org/operasyon önizleme]", e.message); hata(res, 500, "Önizleme alınamadı"); }
  });
  // { tarih, gerekce, onay:true, uyeler:'cikar' } — üyesi olan ekipte üyeliklerin de aynı tarihte bitirilmesi açıkça istenir
  app.post("/org/ekip/:no/operasyon-cikar", yonetKapisi, async (req, res) => {
    const db = await pool.connect();
    try {
      const s = await operasyonEtkisi(req, req.params.no);
      if (!s) return hata(res, 404, "Ekip bulunamadı");
      const e = s.e, t = s.etki;
      if (e.aktif === false) return hata(res, 409, "Ekip zaten pasif");
      const gerekce = temiz(req.body?.gerekce, 500), tarih = tarihMi(req.body?.tarih) ? req.body.tarih : bugun();
      if (!gerekce) return hata(res, 400, "Gerekçe yazın");
      if (req.body?.onay !== true) return hata(res, 400, "Çıkarma etkisini önizleyip onaylayın");
      if (t.acik_isler.length) return hata(res, 409, `${t.acik_isler.length} açık iş ataması var — önce başka ekibe devredin ya da kapatın`, { acik_isler: t.acik_isler });
      if (t.malzeme_bakiye == null) return hata(res, 409, "Ekipteki malzeme bakiyesi okunamadı — veri alınamadan çıkarma yapılmaz");
      if (t.malzeme_bakiye > 0) return hata(res, 409, "Ekipte teslim edilmiş malzeme duruyor — önce depoya dönüş ya da devir yapın");
      if (t.personel.length && req.body?.uyeler !== "cikar") return hata(res, 409, `Ekipte ${t.personel.length} güncel üye var — üyeliklerin de bu tarihte biteceğini onaylayın`, { personel: t.personel });
      await db.query("BEGIN");
      for (const u of t.personel) {
        const p = (await db.query(`SELECT id, ad_soyad, ekip_bilgisi, ekip_arac_plaka FROM personel WHERE id=$1`, [u.id])).rows[0];
        if (!p) continue;
        await uyelikBitir(db, req, p, { tarih, gerekce: `Ekip operasyondan çıkarıldı — ${gerekce}`, tip: "UYE_CIKAR" });
        await aracBagiCoz(db, p);
        await db.query(`UPDATE personel SET ekip_bilgisi=NULL WHERE id=$1`, [p.id]); // personel kaydı ve uygulama hesabı silinmez
      }
      // Araç kaydı silinmez; geçerli tahsis çıkış tarihinde sona erer (başlangıcı sonraya düşen kayıt iptal edilir)
      for (const th of t.arac_tahsisleri) {
        if (th.bas > tarih) await db.query(`UPDATE arac_tahsis SET iptal=true, iptal_gerekce=$2, iptal_eden=$3, iptal_zamani=now() WHERE id=$1`, [th.id, `Ekip operasyondan çıkarıldı — ${gerekce}`.slice(0, 500), kim(req)]);
        else await db.query(`UPDATE arac_tahsis SET bit=$2 WHERE id=$1`, [th.id, tarih]);
        await islemGecmisiYaz(req, "ekip", e.ekip_no, "ARAC_TAHSIS_BITIR", { plaka: th.plaka, bas: th.bas, bit: th.bit }, { plaka: th.plaka, bit: tarih }, `Ekip operasyondan çıkarıldı — ${gerekce}`);
      }
      await db.query(`UPDATE ekipler SET aktif=false, operasyon_bit=$2, updated_at=NOW() WHERE ekip_no=$1`, [e.ekip_no, tarih]);
      await db.query("COMMIT");
      await islemGecmisiYaz(req, "ekip", e.ekip_no, "OPERASYON_CIKIS", { durum: "Aktif", operasyon: e.operasyon_ad || null, bolge: e.bolge || null },
        { durum: "Pasif", operasyon_bitis: tarih, firma_karti: e.firma_gorunen ? `${e.firma_gorunen} — değişmedi` : undefined }, gerekce);
      degisti();
      res.json({ ok: true, biten_tahsis: t.arac_tahsisleri.length, biten_uyelik: t.personel.length, firma_diger_ekipler: t.firma_diger_ekipler });
    } catch (err) { await db.query("ROLLBACK").catch(() => {}); console.error("[org/operasyon çıkar]", err.message); hata(res, 500, "Operasyondan çıkarılamadı"); }
    finally { db.release(); }
  });
  // Mevcut taşeron ekibini bir operasyona bağla / yeniden başlat: { operasyon_firma, bolge?, tarih, gerekce }
  app.post("/org/ekip/:no/operasyon-bagla", yonetKapisi, async (req, res) => {
    try {
      const e = await ekipOku(req.params.no);
      if (!e) return hata(res, 404, "Ekip bulunamadı");
      if (ekipBirlesmis(e)) return hata(res, 409, "Birleştirilmiş kayıt operasyona bağlanamaz");
      if (ekipTuru(e) !== "DIS" || !e.firma_id) return hata(res, 409, "Operasyona yalnız taşeron firma kartına bağlı taşeron ekibi bağlanır (önce ekibi firmaya bağlayın)");
      const op = String(req.body?.operasyon_firma || "").trim().toUpperCase();
      const kodlar = await markaKodlari();
      if (!kodlar.has(op)) return hata(res, 400, "Operasyonu yöneten firmayı seçin");
      const m = orgYetki(req).marka;
      if (m && op !== m) return hata(res, 403, "Yalnız kendi operasyonunuza bağlayabilirsiniz");
      if (m && ekipOperasyonFirma(e) && ekipOperasyonFirma(e) !== m) return hata(res, 403, "Bu ekip firmanızın kapsamında değil");
      const mevcut = ekipOperasyonFirma(e);
      if (mevcut && mevcut !== op && e.aktif !== false) return hata(res, 409, `Ekip şu an ${kodlar.get(mevcut) || mevcut} operasyonunda — önce oradan çıkarın`);
      const f = await firmaOku(e.firma_id);
      if (f && f.aktif === false) return hata(res, 409, `${firmaGorunen(f)} pasif — önce firmayı aktif edin`);
      const gerekce = temiz(req.body?.gerekce, 500), tarih = tarihMi(req.body?.tarih) ? req.body.tarih : bugun();
      if (!gerekce) return hata(res, 400, "Gerekçe yazın");
      const bolge = "bolge" in (req.body || {}) ? (temiz(req.body.bolge, 40) || null) : e.bolge;
      if (bolge && !BOLGELER.includes(bolge) && bolge !== e.bolge) return hata(res, 400, "Geçersiz bölge");
      await pool.query(`UPDATE ekipler SET bagli_firma=$2, bolge=$3, operasyon_bas=$4, operasyon_bit=NULL, aktif=true, updated_at=NOW() WHERE ekip_no=$1`, [e.ekip_no, op, bolge, tarih]);
      await islemGecmisiYaz(req, "ekip", e.ekip_no, "OPERASYON_BAGLA", { operasyon: mevcut ? kodlar.get(mevcut) || mevcut : null, bolge: e.bolge || null, durum: e.aktif !== false ? "Aktif" : "Pasif" },
        { operasyon: kodlar.get(op), bolge, baslangic: tarih, durum: "Aktif" }, gerekce);
      degisti();
      res.json({ ok: true });
    } catch (err) { console.error("[org/operasyon bağla]", err.message); hata(res, 500, "Operasyona bağlanamadı"); }
  });

  // ── EKİP ARAÇ TAHSİSİ (06.11.2026) — mevcut tarihli arac_tahsis tablosu; araç kaydı değişmez / silinmez ──────────
  app.get("/org/arac-secim", yonetKapisi, async (req, res) => {
    try {
      const A = await aracVerisi();
      if (A.hata) return hata(res, 500, "Araç listesi alınamadı");
      const m = orgYetki(req).marka;
      const ek = new Map((await pool.query(`SELECT ekip_no, ad FROM ekipler`)).rows.map((e) => [e.ekip_no, e.ad]));
      res.json({ ok: true, kurulu: A.tahsis_kurulu, araclar: A.araclar.filter((a) => aracAktif(a) && (!m || String(a.firma || "").toUpperCase() === m))
        .map((a) => { const t = A.tahsisler.filter((x) => x.arac_id === a.id);
          return { id: a.id, plaka: a.plaka, arac: [a.marka, a.model].filter(Boolean).join(" ") || null, firma: a.firma || null,
            tahsisli: t.map((x) => ({ tahsis_id: x.id, ekip_no: x.ekip_no, ekip_ad: x.ekip_no ? ek.get(x.ekip_no) || `Ekip ${x.ekip_no}` : null, bas: x.bas, bit: x.bit })) }; })
        .sort((a, b) => String(a.plaka).localeCompare(String(b.plaka))) });
    } catch (e) { hata(res, 500, "Araç listesi alınamadı"); }
  });
  // { arac_id, bas, gerekce, surucu_personel_id?, yerine_tahsis_id? } — yerine_tahsis_id verilirse o tahsis bir gün önce biter (araç değişimi)
  app.post("/org/ekip/:no/arac", yonetKapisi, async (req, res) => {
    const db = await pool.connect();
    try {
      const e = await ekipOku(req.params.no, db);
      if (!e) return hata(res, 404, "Ekip bulunamadı");
      if (!ekipKapsamda(req, e)) return hata(res, 403, "Bu ekip firmanızın kapsamında değil");
      if (e.aktif === false || ekipBirlesmis(e)) return hata(res, 409, "Pasif ekibe araç tahsis edilemez");
      if (!(await tabloVar("arac_tahsis", db))) return hata(res, 409, "Araç tahsisi tablosu kurulmamış");
      const b = req.body || {}, gerekce = temiz(b.gerekce, 500);
      if (!tarihMi(b.bas)) return hata(res, 400, "Başlangıç tarihini girin");
      if (!gerekce) return hata(res, 400, "Gerekçe yazın");
      const arac = (await db.query(`SELECT id, plaka, firma, COALESCE(aktif,true) AS aktif, durum FROM araclar WHERE id=$1`, [Number(b.arac_id) || 0])).rows[0];
      if (!arac) return hata(res, 404, "Araç bulunamadı");
      if (!aracAktif(arac)) return hata(res, 409, `${arac.plaka} pasif — pasif araç tahsis edilemez`);
      const m = orgYetki(req).marka;
      if (m && String(arac.firma || "").toUpperCase() !== m) return hata(res, 403, "Bu araç firmanızın kapsamında değil");
      const uyeler = (await uyeleriOku(db)).filter((p) => String(p.ekip_bilgisi).trim() === String(e.ekip_no));
      const surucu = b.surucu_personel_id ? uyeler.find((p) => p.id === Number(b.surucu_personel_id)) : null;
      if (b.surucu_personel_id && !surucu) return hata(res, 409, "Sürücü olarak yalnız bu ekibin güncel üyesi seçilebilir");
      // Aynı araç aynı tarihlerde başka ekipte / kişide olamaz (yerine geçilen tahsis hariç)
      const yerine = Number(b.yerine_tahsis_id) || null;
      const cak = (await db.query(`SELECT t.id, t.ekip_no, t.personel_id, t.bas::text AS bas, t.bit::text AS bit, ek.ad AS ekip_ad, p.ad_soyad FROM arac_tahsis t
          LEFT JOIN ekipler ek ON ek.ekip_no=t.ekip_no LEFT JOIN personel p ON p.id=t.personel_id
        WHERE NOT t.iptal AND t.arac_id=$1 AND COALESCE(t.bit,'9999-12-31'::date) >= $2::date AND t.id <> COALESCE($3::bigint,0) LIMIT 1`, [arac.id, b.bas, yerine])).rows[0];
      if (cak) return hata(res, 409, `${arac.plaka} ${cak.bas} tarihinden beri ${cak.ekip_ad || cak.ad_soyad || "başka bir kayıtta"} üzerinde tahsisli${cak.bit ? ` (${cak.bit} tarihine kadar)` : ""}. Önce o tahsisi bitirin.`, { cakisan: cak });
      await db.query("BEGIN");
      if (yerine) {
        const es = (await db.query(`SELECT id, plaka, bas::text AS bas, bit::text AS bit FROM arac_tahsis WHERE id=$1 AND NOT iptal AND ekip_no=$2`, [yerine, e.ekip_no])).rows[0];
        if (!es) { await db.query("ROLLBACK"); return hata(res, 404, "Değiştirilecek tahsis bu ekipte bulunamadı"); }
        const onceki = new Date(Date.parse(`${b.bas}T12:00:00Z`) - 86400e3).toISOString().slice(0, 10);
        if (onceki < es.bas) { await db.query("ROLLBACK"); return hata(res, 409, `Yeni başlangıç, değiştirilen tahsisin başlangıcından (${es.bas}) sonra olmalı`); }
        await db.query(`UPDATE arac_tahsis SET bit=$2 WHERE id=$1`, [es.id, onceki]);
        await islemGecmisiYaz(req, "ekip", e.ekip_no, "ARAC_TAHSIS_BITIR", { plaka: es.plaka, bas: es.bas, bit: es.bit }, { plaka: es.plaka, bit: onceki }, `Araç değişimi — ${gerekce}`);
      }
      const ins = await db.query(`INSERT INTO arac_tahsis (arac_id, plaka, personel_id, ekip_no, bas, aciklama, kaynak, giren_email) VALUES ($1,$2,$3,$4,$5,$6,'ORG',$7) RETURNING id`,
        [arac.id, plakaNorm(arac.plaka), surucu?.id || null, e.ekip_no, b.bas, gerekce, kim(req)]);
      await db.query("COMMIT");
      await islemGecmisiYaz(req, "ekip", e.ekip_no, "ARAC_TAHSIS", null, { plaka: arac.plaka, baslangic: b.bas, surucu: surucu?.ad_soyad || null }, gerekce);
      if (c.aracIslemLog) await c.aracIslemLog(req, arac.id, "TAHSIS", ins.rows[0].id, "EKLE", `ekip ${e.ekip_no} · ${b.bas} – devam`).catch(() => {});
      res.json({ ok: true, id: Number(ins.rows[0].id) });
    } catch (err) { await db.query("ROLLBACK").catch(() => {}); console.error("[org/araç]", err.message); hata(res, 500, "Araç tahsis edilemedi"); }
    finally { db.release(); }
  });
  // Tahsisi bitir: { bitis, gerekce } — araç kaydı silinmez, geçerli tahsis sona erer
  app.post("/org/ekip/:no/arac/:tid/bitir", yonetKapisi, async (req, res) => {
    try {
      const e = await ekipOku(req.params.no);
      if (!e) return hata(res, 404, "Ekip bulunamadı");
      if (!ekipKapsamda(req, e)) return hata(res, 403, "Bu ekip firmanızın kapsamında değil");
      if (!(await tabloVar("arac_tahsis"))) return hata(res, 409, "Araç tahsisi tablosu kurulmamış");
      const gerekce = temiz(req.body?.gerekce, 500), bitis = tarihMi(req.body?.bitis) ? req.body.bitis : bugun();
      if (!gerekce) return hata(res, 400, "Gerekçe yazın");
      const uyeIds = (await uyeleriOku()).filter((p) => String(p.ekip_bilgisi).trim() === String(e.ekip_no)).map((p) => p.id);
      const t = (await pool.query(`SELECT id, arac_id, plaka, bas::text AS bas, bit::text AS bit FROM arac_tahsis WHERE id=$1 AND NOT iptal AND (ekip_no=$2 OR personel_id = ANY($3::int[]))`,
        [Number(req.params.tid) || 0, e.ekip_no, uyeIds])).rows[0];
      if (!t) return hata(res, 404, "Tahsis bu ekipte bulunamadı");
      if (bitis < t.bas) return hata(res, 400, `Bitiş, başlangıçtan (${t.bas}) önce olamaz`);
      await pool.query(`UPDATE arac_tahsis SET bit=$2 WHERE id=$1`, [t.id, bitis]);
      await islemGecmisiYaz(req, "ekip", e.ekip_no, "ARAC_TAHSIS_BITIR", { plaka: t.plaka, bas: t.bas, bit: t.bit }, { plaka: t.plaka, bit: bitis }, gerekce);
      if (c.aracIslemLog) await c.aracIslemLog(req, t.arac_id, "TAHSIS", t.id, "BITIR", `ekip ${e.ekip_no} · bitiş ${bitis} · ${gerekce}`).catch(() => {});
      res.json({ ok: true });
    } catch (err) { console.error("[org/araç bitir]", err.message); hata(res, 500, "Tahsis bitirilemedi"); }
  });

  // Teyit: "bu ekibin bilgileri bugün itibarıyla doğru" — kartta ve müşteri çıktısında son teyit zamanı olarak görünür
  app.post("/org/ekip/:no/teyit", yonetKapisi, async (req, res) => {
    try {
      const e = await ekipOku(req.params.no);
      if (!e) return hata(res, 404, "Ekip bulunamadı");
      if (!ekipKapsamda(req, e)) return hata(res, 403, "Bu ekip firmanızın kapsamında değil");
      const r = await pool.query(`UPDATE ekipler SET teyit_zamani=NOW(), teyit_eden=$2 WHERE ekip_no=$1 RETURNING teyit_zamani`, [e.ekip_no, kim(req)]);
      await islemGecmisiYaz(req, "ekip", e.ekip_no, "TEYIT", null, { teyit: "Ekip bilgileri teyit edildi" }, temiz(req.body?.not, 500) || null);
      res.json({ ok: true, teyit_zamani: r.rows[0].teyit_zamani });
    } catch (err) { hata(res, 500, "Teyit kaydedilemedi"); }
  });

  // ── MÜŞTERİYE GÖNDERİLECEK ÇIKTI VERİSİ (06.11.2026) ────────────────────────────────────────────────────────
  // Şema, liste, PDF / PNG ve Excel TEK veri görüntüsünden üretilir. Bu görüntüde maaş, maliyet, hakediş, kimlik no, telefon,
  // e-posta, hesap / yetki ve iç not YOKTUR: yalnız ekip adı, tür, bölge, şef, personel adı + görevi, plaka, durum, teyit.
  // ?operasyon=TEKNO|ERC  ?bolge=  ?tarih=YYYY-MM-DD (geçmiş tarih: yalnız tarihli üyelik kaydı varsa üretilir, yoksa açıkça belirtilir)
  const KURUM_AD = { ERC: "Şimşek Haberleşme" };
  app.get("/org/cikti", gorKapisi, async (req, res) => {
    try {
      const y = orgYetki(req);
      const yapi = await yapiOku(req);
      const kodlar = await markaKodlari();
      const op = y.marka || String(req.query.operasyon || "").trim().toUpperCase() || null;
      if (op && !kodlar.has(op)) return hata(res, 400, "Geçersiz kapsam");
      const bolge = temiz(req.query.bolge, 40) || null;
      const tarih = tarihMi(req.query.tarih) ? req.query.tarih : bugun();
      const gecmis = tarih < bugun();
      if (tarih > bugun()) return hata(res, 400, "İleri tarihli organizasyon üretilemez");
      let ekipler = yapi.ekipler.filter((e) => (!op || e.operasyon_firma === op) && (!bolge || e.bolge === bolge));
      let tarihsel = { istenen: tarih, gecmis, uretilebildi: true, aciklama: null };
      let uyeGecmis = null;
      if (gecmis) {
        // Geçmiş: yalnız başlangıcı bilinen tarihli üyelik satırlarından; bugünkü ilişki geçmişe taşınmaz
        const u = await pool.query(`SELECT u.ekip_no, p.id, p.ad_soyad, p.unvan FROM ekip_uyelik u JOIN personel p ON p.id=u.personel_id
          WHERE u.baslangic IS NOT NULL AND u.baslangic <= $1::date AND (u.bitis IS NULL OR u.bitis > $1::date)`, [tarih]).catch(() => ({ rows: [] }));
        if (!u.rows.length) { tarihsel = { istenen: tarih, gecmis, uretilebildi: false, aciklama: `${tarih} tarihi için tarihli üyelik kaydı yok — geçmiş organizasyon üretilemedi. Kayıtlar tarihli tutulmaya başlandıktan sonraki günler üretilebilir.` }; ekipler = []; }
        else { uyeGecmis = new Map(); for (const r of u.rows) { if (!uyeGecmis.has(r.ekip_no)) uyeGecmis.set(r.ekip_no, []); uyeGecmis.get(r.ekip_no).push(r); }
          ekipler = ekipler.filter((e) => uyeGecmis.has(e.ekip_no));
          tarihsel.aciklama = "Geçmiş tarih: yalnız başlangıcı kayıtlı üyelikler gösterilir; araç ve şef bilgisi o tarih için kayıtlı değilse boş bırakılır."; }
      } else ekipler = ekipler.filter((e) => e.etkin);
      const ekipCikti = (e) => {
        const uyeler = uyeGecmis ? uyeGecmis.get(e.ekip_no) : e.uyeler;
        // Şef: açık şef kaydı; yoksa personel kartında ünvanı "ekip şefi" olan üye (ekrandaki kartla aynı kural)
        const sef = gecmis ? null : (e.sef || e.sef_eski_kural || null);
        return { ekip_no: e.ekip_no, ad: e.ad, tur: e.tur, tur_ad: e.tur_ad, firma: e.tur === "DIS" && e.firma_gorunen && !e.firma_ad_ayni ? e.firma_gorunen : null,
          bolge: e.bolge || null, sef: sef ? sef.ad_soyad : null, sef_durum: gecmis ? "KAYIT_YOK" : sef ? "VAR" : "ATANMADI",
          uyeler: uyeler.map((p) => ({ ad: p.ad_soyad, gorev: temiz(p.unvan, 60) || null, sef: !!sef && p.id === sef.id })),
          arac_durum: gecmis ? "KAYIT_YOK" : e.arac.durum !== "VERI_YOK" && !e.arac.liste.some((a) => a.kayitli) ? "ATANMADI" : e.arac.durum, // müşteri çıktısına yalnız araç kayıtlarında bulunan plaka girer (personel kartındaki kayıtsız / hatalı plaka basılmaz)
          araclar: gecmis ? [] : e.arac.liste.filter((a) => a.kayitli).map((a) => ({ plaka: a.plaka, dogrulanmis: a.dogrulanmis })),
          aktif: e.etkin, teyit: e.teyit ? e.teyit.zaman : null, guncelleme: e.updated_at || null };
      };
      const grup = (t) => ekipler.filter((e) => (t === "DIGER" ? !e.tur : e.tur === t)).map(ekipCikti);
      const bolumler = [{ kod: "IC", baslik: op ? `${kodlar.get(op) || op} İç Ekipleri` : "İç Ekipler", ekipler: grup("IC") },
        { kod: "DIS", baslik: "Taşeron Firmalar", ekipler: grup("DIS") }, { kod: "DIGER", baslik: "Diğer Ekipler", ekipler: grup("DIGER") }].filter((b) => b.ekipler.length);
      const tum = bolumler.flatMap((b) => b.ekipler);
      const kisiler = new Set(tum.flatMap((e) => e.uyeler.map((p) => katla(p.ad)))); // kişi bir kez sayılır
      const plakalar = new Set(tum.flatMap((e) => e.araclar.map((a) => plakaNorm(a.plaka))));
      const teyitler = tum.map((e) => e.teyit).filter(Boolean).map((t) => new Date(t).toISOString()).sort();
      res.json({ ok: true, uretim: new Date().toISOString(),
        kurum: { kod: op || "ERC", ad: op ? (KURUM_AD[op] || kodlar.get(op) || op) : KURUM_AD.ERC },
        kapsam: { operasyon: op, operasyon_ad: op ? kodlar.get(op) || op : "Tüm organizasyon", bolge: bolge || "Tüm bölgeler" },
        tarih, tarihsel, bolumler,
        sayilar: { ekip: tum.length, ic_ekip: tum.filter((e) => e.tur === "IC").length, taseron_ekip: tum.filter((e) => e.tur === "DIS").length, personel: kisiler.size, arac: plakalar.size },
        teyit: { son: teyitler.length ? teyitler[teyitler.length - 1] : null, teyitli_ekip: teyitler.length, teyitsiz_ekip: tum.length - teyitler.length },
        arac_veri: yapi.arac_veri_hatasi ? "VERI_YOK" : "OK", secenekler: { operasyonlar: y.marka ? [] : yapi.operasyonlar, bolgeler: BOLGELER } });
    } catch (e) { console.error("[org/cikti]", e.message); hata(res, 500, "Çıktı verisi alınamadı"); }
  });

  // ── GEÇMİŞ / SİLME ──────────────────────────────────────────────────────────────────────────────────────────
  app.get("/org/gecmis/:modul/:id", yonetKapisi, async (req, res) => {
    try {
      const modul = String(req.params.modul);
      if (!["firma", "ekip"].includes(modul)) return hata(res, 400, "Geçersiz istek");
      if (modul === "firma" && !firmaIslemiKapsamda(req)) return hata(res, 403, "Yetkiniz yok");
      if (modul === "ekip") { const e = await ekipOku(req.params.id); if (e && !ekipKapsamda(req, e)) return hata(res, 403, "Yetkiniz yok"); }
      const r = await pool.query(`SELECT id, tip, eski, yeni, aciklama AS gerekce, COALESCE(kullanici,'—') AS kullanici,
          to_char(created_at,'YYYY-MM-DD HH24:MI') AS zaman FROM islem_gecmisi WHERE modul=$1 AND kayit_id=$2 ORDER BY id DESC LIMIT 300`, [modul, Number(req.params.id)]);
      res.json({ ok: true, kayitlar: r.rows });
    } catch (e) { hata(res, 500, "Geçmiş alınamadı"); }
  });
  // Ekip silme: ayrı izin (org_sil) + hiç kullanılmamış olmalı (üye/üyelik geçmişi, iş etiketiyle iş kaydı, çalışma dönemi bağı yok)
  async function ekipKullanimi(no) {
    const say = async (sql, p) => Number((await pool.query(sql, p).catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n || 0);
    const e = await ekipOku(no);
    if (!e) return null;
    const etiketler = (e.is_etiketleri || []).map((x) => String(x).toUpperCase());
    return await say(`SELECT COUNT(*) n FROM personel WHERE TRIM(COALESCE(ekip_bilgisi,''))=$1`, [String(no)])
      + await say(`SELECT COUNT(*) n FROM ekip_uyelik WHERE ekip_no=$1`, [Number(no)])
      + await say(`SELECT COUNT(*) n FROM personel_calisma_donemi WHERE TRIM(COALESCE(ekip_bilgisi,''))=$1`, [String(no)])
      + (etiketler.length ? await say(`SELECT COUNT(*) n FROM master_works WHERE UPPER(TRIM(subcon_name)) = ANY($1::text[])`, [etiketler]) : 0);
  }
  app.delete("/org/ekip/:no", silKapisi, async (req, res) => {
    try {
      const e = await ekipOku(req.params.no);
      if (!e) return hata(res, 404, "Ekip bulunamadı");
      if (!ekipKapsamda(req, e)) return hata(res, 403, "Bu ekip firmanızın kapsamında değil");
      if (await ekipKullanimi(e.ekip_no)) return hata(res, 409, "Ekip kullanılmış (personel, üyelik geçmişi ya da iş kaydı var) — silinemez, pasife alın");
      await islemGecmisiYaz(req, "ekip", e.ekip_no, "SILME", { ad: e.ad, bolge: e.bolge }, null, temiz(req.body?.gerekce, 500) || "Hatalı kayıt");
      await pool.query(`DELETE FROM ekipler WHERE ekip_no=$1`, [e.ekip_no]);
      degisti();
      res.json({ ok: true });
    } catch (err) { console.error("[org/ekip sil]", err.message); hata(res, 500, "Silinemedi"); }
  });

  // İK personel formu / işten ayrılma gibi mevcut akışlar ekip_bilgisi'ni doğrudan değiştirir: geçmiş kaybolmasın diye
  // üyelik satırı aynı anda kapatılır / açılır (akış engellenmez).
  async function uyelikSenkron(req, personelId, eskiNo, yeniNo, { tarih, gerekce } = {}) {
    const e0 = String(eskiNo || "").trim(), e1 = String(yeniNo || "").trim();
    if (e0 === e1) return;
    const t = tarihMi(tarih) ? tarih : bugun();
    try {
      if (e0) {
        const u = await acikUyelik(pool, personelId, e0);
        if (u) await pool.query(`UPDATE ekip_uyelik SET bitis=$2, bitiren=$3, bitis_gerekce=$4, updated_at=NOW() WHERE id=$1`, [u.id, t, kim(req), gerekce || "İK kaydından değişti"]);
      }
      if (e1 && Number(e1)) await pool.query(`INSERT INTO ekip_uyelik (personel_id, ekip_no, baslangic, baslatan, baslangic_gerekce) VALUES ($1,$2,$3,$4,$5)`,
        [personelId, Number(e1), t, kim(req), gerekce || "İK kaydından atandı"]);
    } catch (err) { console.error("[org uyelik senkron]", err.message); }
  }

  return { orgYetki, yonetKapisi, silKapisi, ekipKapsamda, uyelikSenkron, ekipKullanimi, firmaGorunen, yapiOku };
}

module.exports = { semaKur, kur, katla, BOLGELER, ekipOperasyonda, ekipOperasyonFirma, ekipTuru, ekipBirlesmis, ekipBaglantilari, baglantiVar, BAGLANTI_TR,
  birlestirPlan, birlestirUygula, birlestirGeriAl, plakaNorm, TUR_AD };
