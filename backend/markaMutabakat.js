// ═══ TEKNOCENTER FİNANSMAN VE OPERASYON MUTABAKATI (26.10.2026, Orhan) ══════════════════════════════════════════
// Alt marka (fon modeli PROJE, ör. Teknocenter) için gerçek para akışını kaynak kayıtlarından ayrıştırır ve Şimşek'e
// verilen borcu tek seferlik, izlenebilir ve geri alınabilir bir aktarımla çıkarır. Uygulama koduna sabit tutar YAZILMAZ;
// her toplam mevcut kaynak hareketlerden üretilir (marka_kasa, nakit akışı satırları, is_avans_talep, marka_borc).
//
// Tanımlar (hepsi kesim tarihine kadar, markanın devir tarihinden itibaren; devralınan marka (AHY) hareketleri girmez):
//   F_S  Şimşek'e aktarılan finansman   = marka_kasa girişleri, kaynak = SIMSEK (Şimşek kasasına / hesabına gelen para)
//   O_T  Firmanın kendi kasa ödemeleri   = marka_kasa girişleri, kaynak = FIRMA ("TEKNO Ödeme — …": firma kendi hesabından
//                                          ödedi, Şimşek hesabına gelmedi). Bu girişler Şimşek'e gönderilmiş para DEĞİLDİR;
//                                          karşılığı olan ödeme kaydı nakit akışında (O içinde) zaten vardır → mutabakat eşler.
//   O    Gerçekleşmiş operasyon ödemeleri = nakit akışı satırları (maaş, avans, kira, depozito, taşeron FATURA ödemesi, manuel;
//                                          fon dışı hariç; masraf formu / fatura kaydı ÇIKIŞ DEĞİLDİR — markaNakitSatirlari kuralı)
//   O_S  Şimşek üzerinden ödenen          = O − O_T
//   R    Onaylı, ödenmemiş iş avansı rezervi = markaya ait, direktör onayı belirlenen onaycı (Orhan Bedir'in kullanıcı kimliği)
//                                          tarafından verilmiş, DIREKTOR_ONAY'da bekleyen (reddedilmemiş, ödenmemiş) taleplerin
//                                          ödenmemiş kısmı (tutar − odenen_tutar). Maaş avansı, taslak, masraf formu, ödenmiş avans girmez.
//   Borç ayrılmadan önce kalan           = F_S − O_S   (= proje kasası, borç hareketleri hariç)
//   Şimşek'e borç (aktarım)              = (kalan − R), negatifse borç YOK, finansman açığı gösterilir
//   K    Proje kasası (ayrıştırma sonrası) = kalan − kasa işaretli verilen borç + kasa işaretli geri ödeme
//   Kullanılabilir                       = K − R ; açık = max(0, R − K)
// Aktarım: TEK marka_borc satırı (tip BORC, kaynak AKTARIM, kasa_hareketi=true) + marka_borc_aktarim anlık görüntüsü; aynı
// anda iki aktif aktarım olamaz. Geri alma SİLMEZ: ters kayıt (BORC_IPTAL) + gerekçe; iki taraf tek işlemde (transaction).
// Muhasebe ödemesi (is_avans TAMAMLANDI) nakit akışına düşer → K ve R birlikte azalır; borç satırı değişmez.
const crypto = require("crypto");

const MUTABAKAT_ROLLER = ["admin", "platform_admin", "direktor", "muhasebe", "genel_mudur"];
const KASA_KAYNAK = ["SIMSEK", "FIRMA"];
const BORC_TIPLERI = ["BORC", "ODEME", "BORC_IPTAL", "ODEME_IPTAL"];
const yuvarla = (v) => Math.round(Number(v || 0) * 100) / 100;
const toplam = (arr, al = (x) => x.tutar) => yuvarla(arr.reduce((s, x) => s + Number(al(x) || 0), 0));
const ymd = (d) => { const t = d instanceof Date ? d : new Date(d); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
const trTarih = (s) => String(s || "").slice(0, 10).split("-").reverse().join(".");
const gunFarki = (a, b) => Math.abs((new Date(a + "T12:00:00") - new Date(b + "T12:00:00")) / 86400000);

// Kasa girişinin kaynağı: kayıtta açıkça yazılıysa o; yoksa açıklama "<önek> Ödeme" ile başlıyorsa FIRMA, değilse SIMSEK
// (26.10.2026'dan önceki kayıtların kuralı; aktarım uygulanınca kayda yazılır ve metne bağımlılık kalkar).
function kasaKaynagi(row, P) {
  const k = String(row.kaynak || "").trim().toUpperCase();
  if (KASA_KAYNAK.includes(k)) return k;
  const onek = String(P?.onek || P?.kod || "").trim();
  const rx = new RegExp("^" + onek.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*ödeme", "i");
  return onek && rx.test(String(row.aciklama || "").trim()) ? "FIRMA" : "SIMSEK";
}
const faturaNoBul = (s) => (String(s || "").match(/\b[A-Z]{2,4}\d{10,16}\b/) || [])[0] || null;

async function semaKur(pool) {
  const q = (s) => pool.query(s).catch((e) => console.error("[marka-mutabakat şema]", e.message));
  await q(`ALTER TABLE marka_kasa ADD COLUMN IF NOT EXISTS kaynak TEXT`);
  await q(`ALTER TABLE marka_borc ADD COLUMN IF NOT EXISTS kaynak TEXT DEFAULT 'MANUEL'`);
  await q(`ALTER TABLE marka_borc ADD COLUMN IF NOT EXISTS aktarim_id INTEGER`);
  await q(`ALTER TABLE marka_borc ADD COLUMN IF NOT EXISTS hesap TEXT`);
  await q(`ALTER TABLE marka_borc ADD COLUMN IF NOT EXISTS olusturan TEXT`);
  await q(`ALTER TABLE marka_borc ADD COLUMN IF NOT EXISTS iptal_edilen_id INTEGER`);
  await q(`ALTER TABLE is_avans_talep ADD COLUMN IF NOT EXISTS odenen_tutar NUMERIC`);
  await q(`CREATE TABLE IF NOT EXISTS marka_borc_aktarim (
    id SERIAL PRIMARY KEY, marka TEXT NOT NULL, kesim_ts TIMESTAMPTZ NOT NULL, kesim_gun DATE NOT NULL,
    finansman_simsek NUMERIC, firma_odeme NUMERIC, toplam_odeme NUMERIC, simsek_odeme NUMERIC, kalan_once NUMERIC,
    rezerv NUMERIC, borc_tutar NUMERIC, acik NUMERIC, rezerv_detay JSONB, kaynak_ozet JSONB, onizleme_anahtari TEXT,
    borc_id INTEGER, durum TEXT NOT NULL DEFAULT 'UYGULANDI', aciklama TEXT, olusturan TEXT, created_at TIMESTAMPTZ DEFAULT NOW(),
    geri_alan TEXT, geri_alma_ts TIMESTAMPTZ, geri_alma_gerekce TEXT, ters_borc_id INTEGER)`);
  await q(`CREATE INDEX IF NOT EXISTS marka_borc_aktarim_marka_idx ON marka_borc_aktarim (marka, durum)`);
}

function kur(app, c) {
  const { pool, authMiddleware, markaNakitSatirlari, markaProfil, altMarkaMi, islemGecmisiYaz, avansFirmaSql, rezervOnayciEmails, kullaniciAdi } = c;
  const rol = (u) => String(u?.role || "").toLowerCase();
  const eposta = (u) => String(u?.email || "").toLowerCase().trim();
  const hata = (res, kod, mesaj, ek) => res.status(kod).json({ ok: false, error: mesaj, ...(ek || {}) });
  // Rol + mevcut maaş gizliliği: rapor maaş ödemesi toplamlarını içerir → maas_goruntule=false olan hesaba kapalı (marka-ozet/pl ile aynı kural)
  const yetkiliMi = (req) => MUTABAKAT_ROLLER.includes(rol(req.user)) && req.izinler?.maas_goruntule !== false;
  const markaAl = (req, kaynak) => { const m = String(kaynak?.marka || "").trim().toUpperCase(); return m && altMarkaMi(m) ? m : null; };

  // Belirlenen onaycının kullanıcı kimlikleri (e-posta → users.id/name): kod kişi adına bakmaz, hesap kimliğine bakar
  async function rezervOnaycilari() {
    const mailler = (rezervOnayciEmails() || []).map((x) => String(x).toLowerCase().trim()).filter(Boolean);
    if (!mailler.length) return { mailler: [], kullanicilar: [] };
    const r = await pool.query(`SELECT id, LOWER(TRIM(email)) AS email, name FROM users WHERE LOWER(TRIM(email)) = ANY($1::text[]) ORDER BY id`, [mailler]).catch(() => ({ rows: [] }));
    return { mailler, kullanicilar: r.rows };
  }

  // ── ÇEKİRDEK HESAP: ekran, önizleme, aktarım ve Excel aynı fonksiyonu kullanır ──────────────────────────────────
  async function hesapla(marka, req, { kesim, baslangic } = {}) {
    const P = markaProfil(marka);
    const kesimTs = kesim ? new Date(kesim) : new Date();
    if (isNaN(kesimTs.getTime())) { const e = new Error("Geçersiz kesim tarihi"); e.http = 400; throw e; }
    const kesimGun = ymd(kesimTs);
    const devir = P.devir;
    const [nakit, kasaQ, borcQ, aktQ, onaycilar] = await Promise.all([
      markaNakitSatirlari(marka, req),
      pool.query(`SELECT id, to_char(tarih,'YYYY-MM-DD') AS tarih, tutar, COALESCE(aciklama,'') AS aciklama, COALESCE(belge_yolu,'') AS belge_yolu,
                    kaynak, olusturan FROM marka_kasa WHERE UPPER(marka)=$1 AND tarih <= $2::date ORDER BY tarih, id`, [marka, kesimGun]),
      pool.query(`SELECT id, UPPER(COALESCE(tip,'BORC')) AS tip, to_char(tarih,'YYYY-MM-DD') AS tarih, tutar, COALESCE(aciklama,'') AS aciklama,
                    COALESCE(belge_yolu,'') AS belge_yolu, COALESCE(kasa_hareketi,false) AS kasa_hareketi, COALESCE(kaynak,'MANUEL') AS kaynak,
                    aktarim_id, hesap, olusturan, iptal_edilen_id
                  FROM marka_borc WHERE UPPER(marka)=$1 AND tarih <= $2::date ORDER BY tarih, id`, [marka, kesimGun]),
      pool.query(`SELECT * FROM marka_borc_aktarim WHERE UPPER(marka)=$1 ORDER BY id DESC`, [marka]).catch(() => ({ rows: [] })),
      rezervOnaycilari(),
    ]);
    // 1) Operasyon ödemeleri (kesime kadar, fon dışı hariç)
    const odemeler = (nakit.rows || []).filter((r) => r.tarih && r.tarih >= devir && r.tarih <= kesimGun && r.kasadan_dus !== false)
      .map((r) => ({ ...r, tutar: Number(r.tutar || 0), ref: `${r.kaynak || r.tip}${r.kaynak_id ? " #" + r.kaynak_id : ""}` }));
    const fonDisi = (nakit.rows || []).filter((r) => r.tarih && r.tarih >= devir && r.tarih <= kesimGun && r.kasadan_dus === false);
    const O = toplam(odemeler);
    // 2) Kasa girişleri: Şimşek'e giren / firmanın kendi kasası
    const kasa = kasaQ.rows.map((k) => ({ ...k, tutar: Number(k.tutar || 0), kaynak_etkin: kasaKaynagi(k, P), kaynak_kayitli: !!k.kaynak }));
    const simsekGiris = kasa.filter((k) => k.kaynak_etkin === "SIMSEK"), firmaGiris = kasa.filter((k) => k.kaynak_etkin === "FIRMA");
    const F_S = toplam(simsekGiris), O_T = toplam(firmaGiris);
    // 3) Firma kasa girişi ↔ ödeme kaydı mutabakatı (aynı ödeme iki tablodan geliyorsa tekrar toplanmaz: kasa girişi
    //    finansman tarafında, ödeme kaydı ödeme tarafında birer kez; eşleşmeyen varsa fark açıkça gösterilir)
    const kullanilan = new Set();
    const eslesmeler = firmaGiris.map((k) => {
      const fno = faturaNoBul(k.aciklama);
      const aday = odemeler.map((o, i) => ({ o, i })).filter(({ o, i }) => !kullanilan.has(i) && o.tutar > 0 && Math.abs(o.tutar - k.tutar) < 1 && gunFarki(o.tarih, k.tarih) <= 45)
        .map((x) => ({ ...x, puan: (fno && x.o.fatura_no && String(x.o.fatura_no).toUpperCase() === fno ? 100 : 0) - gunFarki(x.o.tarih, k.tarih) }))
        .sort((a, b) => b.puan - a.puan)[0];
      if (aday) kullanilan.add(aday.i);
      return { kasa: k, odeme: aday ? aday.o : null, fatura_no: fno };
    });
    const firmaEslesen = eslesmeler.filter((e) => e.odeme), firmaEslesmeyen = eslesmeler.filter((e) => !e.odeme);
    const firmaEslesenToplam = toplam(firmaEslesen, (e) => e.odeme.tutar);
    const O_S = yuvarla(O - O_T);
    const kalanOnce = yuvarla(F_S - O_S);
    const odemeKasasi = (i) => (kullanilan.has(i) ? "FIRMA" : "SIMSEK");
    // 4) Borç defteri (kesime kadar): anapara, geri ödeme, ters kayıtlar, kasa etkisi
    const borc = borcQ.rows.map((b) => ({ ...b, tutar: Number(b.tutar || 0) }));
    const tipT = (t, kasaYalniz) => toplam(borc.filter((b) => b.tip === t && (!kasaYalniz || b.kasa_hareketi)));
    const borcAnapara = yuvarla(tipT("BORC") - tipT("BORC_IPTAL"));
    const borcGeri = yuvarla(tipT("ODEME") - tipT("ODEME_IPTAL"));
    const borcKalan = yuvarla(borcAnapara - borcGeri);
    const borcKasaCikis = yuvarla(tipT("BORC", true) - tipT("BORC_IPTAL", true));
    const geriKasaGiris = yuvarla(tipT("ODEME", true) - tipT("ODEME_IPTAL", true));
    const geriHesap = { PROJE_KASASI: yuvarla(toplam(borc.filter((b) => b.tip === "ODEME" && b.kasa_hareketi)) - toplam(borc.filter((b) => b.tip === "ODEME_IPTAL" && b.kasa_hareketi))),
      FIRMA_HESABI: yuvarla(toplam(borc.filter((b) => b.tip === "ODEME" && !b.kasa_hareketi)) - toplam(borc.filter((b) => b.tip === "ODEME_IPTAL" && !b.kasa_hareketi))) };
    // 5) Onaylı ve ödenmemiş iş avansı rezervi (kesimdeki direktör onayı; onaycı kimliği işlem geçmişinden)
    const aq = await pool.query(`
      SELECT t.id, t.tutar, COALESCE(t.odenen_tutar,0) AS odenen_tutar, t.durum, t.gider_turu, t.aciklama, t.not_aciklama, t.bolge, t.proje,
             t.talep_eden_ad, t.talep_eden_email, to_char(t.tarih,'YYYY-MM-DD') AS tarih,
             to_char(t.direktor_onay_tarihi,'YYYY-MM-DD') AS direktor_onay_tarihi, COALESCE(NULLIF(p.ad_soyad,''), t.talep_eden_ad) AS kisi,
             ${avansFirmaSql("t", "p")} AS talep_firma,
             (SELECT g.kullanici FROM islem_gecmisi g WHERE g.modul='avans' AND g.kayit_id=t.id AND g.tip='ONAY'
                AND COALESCE(g.yeni->>'durum','') = 'DIREKTOR_ONAY' ORDER BY g.id DESC LIMIT 1) AS direktor_onaycisi
      FROM is_avans_talep t LEFT JOIN personel p ON p.id = t.personel_id
      WHERE t.durum = 'DIREKTOR_ONAY' AND t.direktor_onay_tarihi IS NOT NULL AND t.direktor_onay_tarihi <= $1::date
      ORDER BY t.direktor_onay_tarihi, t.id`, [kesimGun]).catch(() => ({ rows: [] }));
    const onayciMail = new Set(onaycilar.mailler);
    const avansSatir = (t) => {
      const tutar = Number(t.tutar || 0), odenen = Math.min(tutar, Math.max(0, Number(t.odenen_tutar || 0)));
      return { id: t.id, talep_no: `#${t.id}`, kisi: t.kisi, firma: t.talep_firma, aciklama: [t.gider_turu, t.aciklama, t.not_aciklama].filter(Boolean).join(" · "),
        bolge: t.bolge || "", proje: t.proje || "", talep_tarihi: t.tarih, onay_tarihi: t.direktor_onay_tarihi, onaylayan: t.direktor_onaycisi || null,
        onaylayan_ad: t.direktor_onaycisi ? (onaycilar.kullanicilar.find((u) => u.email === String(t.direktor_onaycisi).toLowerCase())?.name || t.direktor_onaycisi) : "onaycı kaydı yok (işlem geçmişi öncesi)",
        onaylanan: tutar, odenen, kalan: yuvarla(tutar - odenen) };
    };
    const markaAvanslari = aq.rows.filter((t) => String(t.talep_firma || "").toUpperCase() === marka).map(avansSatir);
    const rezervSatirlari = markaAvanslari.filter((a) => a.onaylayan && onayciMail.has(String(a.onaylayan).toLowerCase()) && a.kalan > 0);
    const rezervDisi = markaAvanslari.filter((a) => !(a.onaylayan && onayciMail.has(String(a.onaylayan).toLowerCase())) && a.kalan > 0);
    const R = toplam(rezervSatirlari, (a) => a.kalan);
    // 6) Proje kasası ve kullanılabilir bakiye
    const K = yuvarla(kalanOnce - borcKasaCikis + geriKasaGiris);
    const kullanilabilir = yuvarla(K - R);
    const acik = Math.max(0, yuvarla(R - K));
    const aktif = aktQ.rows.find((a) => a.durum === "UYGULANDI") || null;
    const oneri = aktif ? null : { borc: Math.max(0, yuvarla(K - R)), acik: Math.max(0, yuvarla(R - K)) };
    const anahtar = crypto.createHash("sha1").update(JSON.stringify({ marka, kesimGun, F_S, O_T, O, R, K, borcAnapara, borcGeri, n: odemeler.length, k: kasa.length, b: borc.length })).digest("hex").slice(0, 16);
    // 7) Tarih aralığı: açılış (devir → başlangıçtan önce), dönem, kapanış — Excel ve rapor için
    const basl = baslangic && /^\d{4}-\d{2}-\d{2}$/.test(String(baslangic)) && baslangic > devir ? String(baslangic) : null;
    const donem = basl ? (() => {
      const onceKasa = kasa.filter((k) => k.tarih < basl), onceOd = odemeler.filter((o) => o.tarih < basl);
      const acilis = yuvarla(toplam(onceKasa) - toplam(onceOd) - toplam(borc.filter((b) => b.tarih < basl && b.kasa_hareketi && b.tip === "BORC")) + toplam(borc.filter((b) => b.tarih < basl && b.kasa_hareketi && b.tip === "BORC_IPTAL"))
        + toplam(borc.filter((b) => b.tarih < basl && b.kasa_hareketi && b.tip === "ODEME")) - toplam(borc.filter((b) => b.tarih < basl && b.kasa_hareketi && b.tip === "ODEME_IPTAL")));
      const giris = yuvarla(toplam(kasa.filter((k) => k.tarih >= basl)) + toplam(borc.filter((b) => b.tarih >= basl && b.kasa_hareketi && b.tip === "ODEME")) - toplam(borc.filter((b) => b.tarih >= basl && b.kasa_hareketi && b.tip === "ODEME_IPTAL")));
      const cikis = yuvarla(toplam(odemeler.filter((o) => o.tarih >= basl)) + toplam(borc.filter((b) => b.tarih >= basl && b.kasa_hareketi && b.tip === "BORC")) - toplam(borc.filter((b) => b.tarih >= basl && b.kasa_hareketi && b.tip === "BORC_IPTAL")));
      return { baslangic: basl, acilis, giris, cikis, kapanis: yuvarla(acilis + giris - cikis) };
    })() : null;
    return {
      marka, marka_ad: P.ad, fon_modeli: P.fonModeli, devir, kesim: kesimTs.toISOString(), kesim_gun: kesimGun, onizleme_anahtari: anahtar,
      ozet: {
        finansman_simsek: F_S, firma_odeme: O_T, toplam_finansman: yuvarla(F_S + O_T),
        toplam_odeme: O, simsek_odeme: O_S, kalan_once: kalanOnce,
        rezerv: R, rezerv_adet: rezervSatirlari.length, rezerv_disi: toplam(rezervDisi, (a) => a.kalan), rezerv_disi_adet: rezervDisi.length,
        proje_kasasi: K, kullanilabilir, acik,
        borc_anapara: borcAnapara, borc_geri: borcGeri, borc_kalan: borcKalan, borc_kasa_cikis: borcKasaCikis, geri_kasa_giris: geriKasaGiris, geri_hesap: geriHesap,
        fon_disi: toplam(fonDisi),
      },
      mutabakat: {
        firma_giris: O_T, firma_eslesen: firmaEslesenToplam, firma_eslesmeyen: toplam(firmaEslesmeyen, (e) => e.kasa.tutar), fark: yuvarla(O_T - firmaEslesenToplam),
        uyumlu: firmaEslesmeyen.length === 0 && Math.abs(O_T - firmaEslesenToplam) < 1,
        kontroller: [
          { ad: "Toplam finansman = Şimşek'e aktarılan + firmanın kendi kasası", sol: yuvarla(F_S + O_T), sag: yuvarla(F_S + O_T), ok: true },
          { ad: "Şimşek üzerinden ödenen = toplam ödeme − firmanın kendi ödemeleri", sol: O_S, sag: yuvarla(O - O_T), ok: true },
          { ad: "Borç öncesi kalan = Şimşek'e aktarılan − Şimşek üzerinden ödenen", sol: kalanOnce, sag: yuvarla(F_S - O_S), ok: true },
          { ad: "Firma kasa girişleri ↔ ödeme kayıtları eşleşmesi (fark 0 olmalı)", sol: O_T, sag: firmaEslesenToplam, ok: firmaEslesmeyen.length === 0 && Math.abs(O_T - firmaEslesenToplam) < 1 },
          { ad: "Proje kasası = borç öncesi kalan − kasadan verilen borç + kasaya geri ödeme", sol: K, sag: yuvarla(kalanOnce - borcKasaCikis + geriKasaGiris), ok: true },
          { ad: "Kullanılabilir = proje kasası − onaylı avans rezervi", sol: kullanilabilir, sag: yuvarla(K - R), ok: true },
        ],
      },
      oneri, aktarim: aktif ? { ...aktif, rezerv_detay: aktif.rezerv_detay, kaynak_ozet: aktif.kaynak_ozet } : null, aktarim_gecmisi: aktQ.rows,
      donem,
      detay: {
        finansman_simsek: simsekGiris.map((k) => ({ id: k.id, tarih: k.tarih, tutar: k.tutar, aciklama: k.aciklama, belge_url: k.belge_yolu, ref: `marka_kasa #${k.id}`, kaynak: "SIMSEK", kaynak_kayitli: k.kaynak_kayitli })),
        firma_odeme: eslesmeler.map((e) => ({ id: e.kasa.id, tarih: e.kasa.tarih, tutar: e.kasa.tutar, aciklama: e.kasa.aciklama, belge_url: e.kasa.belge_yolu, ref: `marka_kasa #${e.kasa.id}`, kaynak: "FIRMA", kaynak_kayitli: e.kasa.kaynak_kayitli,
          eslesen_odeme: e.odeme ? { ref: e.odeme.ref, tarih: e.odeme.tarih, tutar: e.odeme.tutar, kisi: e.odeme.ad_soyad, aciklama: e.odeme.aciklama, tip: e.odeme.tip, fatura_no: e.odeme.fatura_no || null } : null })),
        toplam_odeme: odemeler.map((o, i) => ({ tarih: o.tarih, tip: o.tip, kisi: o.ad_soyad, aciklama: o.aciklama, tutar: o.tutar, ref: o.ref, fatura_no: o.fatura_no || null, plaka: o.plaka || null, donem: o.donem || null,
          odeyen_kasa: odemeKasasi(i), odeme_yontemi: o.odeme_yontemi || "" })),
        rezerv: rezervSatirlari, rezerv_disi: rezervDisi,
        borc: borc.map((b) => ({ ...b })),
        fon_disi: fonDisi.map((o) => ({ tarih: o.tarih, tip: o.tip, kisi: o.ad_soyad, aciklama: o.aciklama, tutar: Number(o.tutar || 0), ref: `${o.kaynak || o.tip}${o.kaynak_id ? " #" + o.kaynak_id : ""}` })),
        onaycilar: onaycilar.kullanicilar.map((u) => ({ id: u.id, ad: u.name, email: u.email })),
        kasa_etiketlenecek: kasa.filter((k) => !k.kaynak_kayitli).map((k) => ({ id: k.id, tarih: k.tarih, tutar: k.tutar, aciklama: k.aciklama, kaynak: k.kaynak_etkin })),
      },
    };
  }

  // ── UÇLAR ─────────────────────────────────────────────────────────────────────────────────────────────────────
  // Özet + kaynak detayları (ekran kartları). Firma kapsamı: MARKA PANELİ FİRMA KAPSAMI katmanı marka=oturum zorlar.
  app.get("/finance/marka-mutabakat", authMiddleware, async (req, res) => {
    try {
      if (!yetkiliMi(req)) return hata(res, 403, "Yetkiniz yok");
      const marka = markaAl(req, req.query);
      if (!marka) return hata(res, 400, "Geçerli bir alt marka belirtilmeli");
      const h = await hesapla(marka, req, { kesim: req.query.kesim, baslangic: req.query.baslangic });
      res.json({ ok: true, ...h });
    } catch (e) { console.error("MARKA MUTABAKAT:", e.message); hata(res, e.http || 500, e.http ? e.message : "Mutabakat hesaplanamadı"); }
  });
  app.get("/finance/marka-borc-aktarim", authMiddleware, async (req, res) => {
    try {
      if (!yetkiliMi(req)) return hata(res, 403, "Yetkiniz yok");
      const marka = markaAl(req, req.query);
      if (!marka) return hata(res, 400, "Geçerli bir alt marka belirtilmeli");
      const r = await pool.query(`SELECT * FROM marka_borc_aktarim WHERE UPPER(marka)=$1 ORDER BY id DESC`, [marka]);
      res.json({ ok: true, rows: r.rows });
    } catch (e) { hata(res, 500, e.message); }
  });
  // Önizleme: hiçbir şey yazmaz; uygulanacak değişikliklerin listesini ve anahtarı döner
  app.post("/finance/marka-borc-aktarim/onizle", authMiddleware, async (req, res) => {
    try {
      if (!yetkiliMi(req)) return hata(res, 403, "Yetkiniz yok");
      const marka = markaAl(req, req.body);
      if (!marka) return hata(res, 400, "Geçerli bir alt marka belirtilmeli");
      const h = await hesapla(marka, req, { kesim: req.body?.kesim });
      res.json({ ok: true, ...onizlemeNesnesi(h) });
    } catch (e) { hata(res, e.http || 500, e.message); }
  });
  function onizlemeNesnesi(h) {
    const o = h.ozet;
    const degisiklikler = [];
    for (const k of h.detay.kasa_etiketlenecek) degisiklikler.push({ tur: "KASA_KAYNAK", kayit: `marka_kasa #${k.id}`, tarih: k.tarih, tutar: k.tutar, aciklama: k.aciklama, yeni: k.kaynak === "FIRMA" ? "Firmanın kendi kasası (Şimşek'e gönderilmedi)" : "Şimşek kasasına giren finansman" });
    if (!h.aktarim && h.oneri && h.oneri.borc > 0) degisiklikler.push({ tur: "BORC_KAYDI", kayit: "marka_borc (yeni)", tarih: h.kesim_gun, tutar: h.oneri.borc,
      aciklama: `Şimşek'in ${h.marka_ad}'a borcu — finansman ayrıştırması (kesim ${trTarih(h.kesim_gun)}); alacaklı ${h.marka_ad}, borçlu Şimşek; proje kasasından çıkar, gider değildir` });
    return { marka: h.marka, kesim: h.kesim, kesim_gun: h.kesim_gun, onizleme_anahtari: h.onizleme_anahtari, ozet: o, mutabakat: h.mutabakat, oneri: h.oneri, aktarim: h.aktarim,
      rezerv: h.detay.rezerv, rezerv_disi: h.detay.rezerv_disi, mevcut_borclar: h.detay.borc, degisiklikler,
      uyarilar: [
        ...(h.aktarim ? [`Zaten uygulanmış bir aktarım var (#${h.aktarim.id}, ${trTarih(h.aktarim.kesim_gun)}); aynı tutar yeniden borçlandırılmaz. Önce geri alın.`] : []),
        ...(h.oneri && h.oneri.acik > 0 ? [`Finansman açığı ₺${h.oneri.acik.toLocaleString("tr-TR")}: rezerv proje kasasını aşıyor — borç kaydı oluşturulmaz.`] : []),
        ...(!h.mutabakat.uyumlu ? [`Firma kasa girişleri ile ödeme kayıtları tam eşleşmiyor (fark ₺${h.mutabakat.fark.toLocaleString("tr-TR")}, eşleşmeyen ₺${h.mutabakat.firma_eslesmeyen.toLocaleString("tr-TR")}). Dengeleme kaydı üretilmez; kaynak kayıtları kontrol edin.`] : []),
        ...(h.detay.borc.some((b) => b.kaynak === "MANUEL" && b.tip === "BORC") ? [`Elle girilmiş borç kaydı var (${h.detay.borc.filter((b) => b.kaynak === "MANUEL" && b.tip === "BORC").map((b) => `#${b.id} ₺${b.tutar.toLocaleString("tr-TR")}`).join(", ")}); aktarım bunları değiştirmez, aynı tutarı tekrar borçlandırmadığınızdan emin olun.`] : []),
        ...(h.ozet.rezerv_disi > 0 ? [`Direktör onayı belirlenen onaycıya ait olmayan ${h.ozet.rezerv_disi_adet} bekleyen avans (₺${h.ozet.rezerv_disi.toLocaleString("tr-TR")}) rezerve ALINMADI; listede ayrıca gösterilir.`] : []),
      ] };
  }
  // Uygula: tek işlemde (transaction) kasa kaynak etiketleri + borç satırı + anlık görüntü. İkinci çağrı 409.
  app.post("/finance/marka-borc-aktarim", authMiddleware, async (req, res) => {
    const client = await pool.connect();
    try {
      if (!yetkiliMi(req)) return hata(res, 403, "Yetkiniz yok");
      const marka = markaAl(req, req.body);
      if (!marka) return hata(res, 400, "Geçerli bir alt marka belirtilmeli");
      const h = await hesapla(marka, req, { kesim: req.body?.kesim });
      if (h.aktarim) return hata(res, 409, `Zaten uygulanmış bir aktarım var (#${h.aktarim.id}); aynı tutar yeniden borçlandırılmaz`, { aktarim: h.aktarim });
      if (String(req.body?.onizleme_anahtari || "") !== h.onizleme_anahtari) return hata(res, 409, "Önizlemeden sonra kaynak kayıtlar değişti — önizlemeyi yenileyip tekrar deneyin", { onizleme_anahtari: h.onizleme_anahtari });
      if (!h.oneri || h.oneri.borc <= 0) return hata(res, 400, `Borç kaydı oluşturulmadı: finansman açığı ₺${(h.oneri?.acik || 0).toLocaleString("tr-TR")} (rezerv proje kasasını aşıyor)`);
      const kullanici = eposta(req.user) || null;
      const on = onizlemeNesnesi(h);
      await client.query("BEGIN");
      for (const k of h.detay.kasa_etiketlenecek) await client.query(`UPDATE marka_kasa SET kaynak=$1 WHERE id=$2 AND kaynak IS NULL`, [k.kaynak, k.id]);
      const acikl = `Şimşek'in ${h.marka_ad}'a borcu — finansman ayrıştırması (kesim ${trTarih(h.kesim_gun)}): Şimşek'e aktarılan ₺${h.ozet.finansman_simsek.toLocaleString("tr-TR")} − Şimşek üzerinden ödenen ₺${h.ozet.simsek_odeme.toLocaleString("tr-TR")} − onaylı avans rezervi ₺${h.ozet.rezerv.toLocaleString("tr-TR")}${req.body?.aciklama ? " · " + String(req.body.aciklama).slice(0, 300) : ""}`;
      const b = await client.query(`INSERT INTO marka_borc (marka, tip, tarih, tutar, aciklama, kasa_hareketi, kaynak, olusturan) VALUES ($1,'BORC',$2,$3,$4,true,'AKTARIM',$5) RETURNING id`,
        [marka, h.kesim_gun, h.oneri.borc, acikl, kullanici]);
      const a = await client.query(`INSERT INTO marka_borc_aktarim (marka, kesim_ts, kesim_gun, finansman_simsek, firma_odeme, toplam_odeme, simsek_odeme, kalan_once, rezerv, borc_tutar, acik,
          rezerv_detay, kaynak_ozet, onizleme_anahtari, borc_id, durum, aciklama, olusturan)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'UYGULANDI',$16,$17) RETURNING *`,
        [marka, h.kesim, h.kesim_gun, h.ozet.finansman_simsek, h.ozet.firma_odeme, h.ozet.toplam_odeme, h.ozet.simsek_odeme, h.ozet.kalan_once, h.ozet.rezerv, h.oneri.borc, h.oneri.acik,
          JSON.stringify({ rezerv: h.detay.rezerv, rezerv_disi: h.detay.rezerv_disi }), JSON.stringify({ mutabakat: h.mutabakat, kasa_etiketlenen: h.detay.kasa_etiketlenecek, proje_kasasi: h.ozet.proje_kasasi, degisiklikler: on.degisiklikler }),
          h.onizleme_anahtari, b.rows[0].id, req.body?.aciklama ? String(req.body.aciklama).slice(0, 500) : null, kullanici]);
      await client.query(`UPDATE marka_borc SET aktarim_id=$1 WHERE id=$2`, [a.rows[0].id, b.rows[0].id]);
      await client.query("COMMIT");
      await islemGecmisiYaz(req, "borc_aktarim", a.rows[0].id, "OLUSTURMA", null, { marka, kesim: h.kesim_gun, borc_tutar: h.oneri.borc, rezerv: h.ozet.rezerv, borc_id: b.rows[0].id }, "Finansman ayrıştırması — Şimşek'e borç aktarımı");
      res.json({ ok: true, aktarim: a.rows[0], borc_id: b.rows[0].id });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("MARKA BORC AKTARIM:", e.message);
      hata(res, e.http || 500, e.http ? e.message : "Aktarım uygulanamadı — hiçbir kayıt değişmedi");
    } finally { client.release(); }
  });
  // Geri alma: ters kayıt (BORC_IPTAL) + gerekçe; orijinal satır ve geçmiş silinmez, kasa etkisi aynı anda terslenir
  app.post("/finance/marka-borc-aktarim/:id/geri-al", authMiddleware, async (req, res) => {
    const client = await pool.connect();
    try {
      if (!yetkiliMi(req)) return hata(res, 403, "Yetkiniz yok");
      const gerekce = String(req.body?.gerekce || "").trim();
      if (gerekce.length < 5) return hata(res, 400, "Geri alma gerekçesi zorunlu (en az 5 karakter)");
      const a = (await pool.query(`SELECT * FROM marka_borc_aktarim WHERE id=$1`, [Number(req.params.id)])).rows[0];
      if (!a) return hata(res, 404, "Aktarım bulunamadı");
      if (a.durum !== "UYGULANDI") return hata(res, 409, "Bu aktarım zaten geri alınmış");
      const b = (await pool.query(`SELECT id, marka, tutar, COALESCE(kasa_hareketi,false) AS kasa_hareketi FROM marka_borc WHERE id=$1`, [a.borc_id])).rows[0];
      if (!b) return hata(res, 409, "Aktarımın borç kaydı bulunamadı — elle kontrol gerekir");
      const kullanici = eposta(req.user) || null;
      await client.query("BEGIN");
      const t = await client.query(`INSERT INTO marka_borc (marka, tip, tarih, tutar, aciklama, kasa_hareketi, kaynak, olusturan, aktarim_id, iptal_edilen_id)
        VALUES ($1,'BORC_IPTAL',$2,$3,$4,$5,'TERS_KAYIT',$6,$7,$8) RETURNING id`,
        [b.marka, ymd(new Date()), b.tutar, `Ters kayıt — borç #${b.id} (aktarım #${a.id}) geri alındı: ${gerekce}`, b.kasa_hareketi, kullanici, a.id, b.id]);
      await client.query(`UPDATE marka_borc_aktarim SET durum='GERI_ALINDI', geri_alan=$1, geri_alma_ts=NOW(), geri_alma_gerekce=$2, ters_borc_id=$3 WHERE id=$4`, [kullanici, gerekce, t.rows[0].id, a.id]);
      await client.query("COMMIT");
      await islemGecmisiYaz(req, "borc_aktarim", a.id, "GERI_AL", { durum: "UYGULANDI", borc_id: b.id }, { durum: "GERI_ALINDI", ters_borc_id: t.rows[0].id }, gerekce);
      res.json({ ok: true, ters_borc_id: t.rows[0].id });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      hata(res, 500, "Geri alma uygulanamadı — hiçbir kayıt değişmedi");
    } finally { client.release(); }
  });

  // ── EXCEL: "Teknocenter Finansman ve Operasyon Mutabakatı" — ekranla aynı hesap (hesapla) ─────────────────────
  app.get("/finance/marka-mutabakat/excel", authMiddleware, async (req, res) => {
    try {
      if (!yetkiliMi(req)) return hata(res, 403, "Yetkiniz yok");
      const marka = markaAl(req, req.query);
      if (!marka) return hata(res, 400, "Geçerli bir alt marka belirtilmeli");
      const h = await hesapla(marka, req, { kesim: req.query.kesim, baslangic: req.query.baslangic });
      const ExcelJS = require("exceljs");
      const wb = new ExcelJS.Workbook(); wb.creator = "Omnix";
      const LACI = "FF1F4E78", KOYU = "FF203864", ACIK = "FFF8FAFC", BEYAZ = "FFFFFFFF";
      const para = (v) => Number(v || 0);
      const sayfa = (ad, baslik, kolonlar, satirlar, opts = {}) => {
        const ws = wb.addWorksheet(ad);
        ws.mergeCells(1, 1, 1, kolonlar.length);
        const t = ws.getCell(1, 1); t.value = baslik; t.font = { bold: true, size: 13, color: { argb: BEYAZ }, name: "Calibri" };
        t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LACI } }; t.alignment = { horizontal: "center", vertical: "middle" }; ws.getRow(1).height = 26;
        kolonlar.forEach((k, i) => { const c = ws.getCell(2, i + 1); c.value = k.ad; c.font = { bold: true, size: 10, color: { argb: BEYAZ } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: KOYU } };
          c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; ws.getColumn(i + 1).width = k.w || 16; });
        ws.getRow(2).height = 22;
        satirlar.forEach((s, ri) => {
          const row = ws.getRow(ri + 3);
          const hucreler = Array.isArray(s) ? s : s.cells;
          hucreler.forEach((v, i) => { const c = row.getCell(i + 1); c.value = v; if (kolonlar[i].para) { c.numFmt = '#,##0.00 "₺"'; c.alignment = { horizontal: "right" }; }
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ri % 2 ? BEYAZ : ACIK } };
            c.border = { top: { style: "hair", color: { argb: "FFD1D5DB" } }, bottom: { style: "hair", color: { argb: "FFD1D5DB" } }, left: { style: "hair", color: { argb: "FFD1D5DB" } }, right: { style: "hair", color: { argb: "FFD1D5DB" } } };
            if (!Array.isArray(s) && s.bold) c.font = { bold: true }; });
        });
        ws.views = [{ state: "frozen", ySplit: 2, showGridLines: false }];
        if (!opts.filtresiz && satirlar.length) ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: kolonlar.length } };
        return ws;
      };
      const o = h.ozet, kesimTR = trTarih(h.kesim_gun), bas = h.donem ? `${trTarih(h.donem.baslangic)} – ${kesimTR}` : `${trTarih(h.devir)} – ${kesimTR}`;
      const ozetSatir = [
        ["Rapor dönemi", bas], ["Kesim tarihi / saati", new Date(h.kesim).toLocaleString("tr-TR")], ["Fon modeli", h.fon_modeli], ["", ""],
        [`${h.marka_ad}'dan Şimşek'e aktarılan toplam finansman`, o.finansman_simsek], [`${h.marka_ad}'ın kendi kasasından yaptığı ödemeler`, o.firma_odeme], ["Toplam finansman (ikisinin toplamı)", o.toplam_finansman],
        ["Toplam gerçekleşmiş operasyon ödemeleri", o.toplam_odeme], ["Şimşek üzerinden yapılan operasyon ödemeleri", o.simsek_odeme], ["Borç ayrılmadan önce kalan (Şimşek'e aktarılan − Şimşek üzerinden ödenen)", o.kalan_once],
        ["Ödenmeyi bekleyen onaylı iş avansı rezervi", o.rezerv], ["Borç ayrıştırması sonrası proje kasası", o.proje_kasasi], ["Rezerv dışında kullanılabilir proje bakiyesi", o.kullanilabilir], ["Finansman açığı", o.acik],
        ["Şimşek'e verilen borç anaparası (alacaklı: " + h.marka_ad + ", borçlu: Şimşek)", o.borc_anapara], ["Şimşek'ten alınan gerçek geri ödemeler", o.borc_geri], ["   · proje kasasına gelen", o.geri_hesap.PROJE_KASASI], ["   · firma hesabına gelen (kasa dışı)", o.geri_hesap.FIRMA_HESABI], ["Kalan Şimşek borcu", o.borc_kalan],
        ["", ""], ["Mutabakat durumu", h.mutabakat.uyumlu ? "UYUMLU — firma kasa girişleri ödeme kayıtlarıyla birebir eşleşti" : `FARK VAR — eşleşmeyen ₺${h.mutabakat.firma_eslesmeyen.toLocaleString("tr-TR")}`],
        ...(h.aktarim ? [["Uygulanan aktarım", `#${h.aktarim.id} · kesim ${trTarih(h.aktarim.kesim_gun)} · borç ₺${Number(h.aktarim.borc_tutar).toLocaleString("tr-TR")} · ${h.aktarim.olusturan || ""}`]] : [["Aktarım", "Henüz uygulanmadı (öneri: borç ₺" + (h.oneri?.borc || 0).toLocaleString("tr-TR") + ")"]]),
        ...(h.donem ? [["", ""], ["Dönem açılış bakiyesi (devirden başlangıca kadar)", h.donem.acilis], ["Dönem girişleri", h.donem.giris], ["Dönem çıkışları", h.donem.cikis], ["Dönem kapanış bakiyesi", h.donem.kapanis]] : []),
      ];
      sayfa("Yönetici Özeti", `${h.marka_ad.toUpperCase()} — FİNANSMAN VE OPERASYON MUTABAKATI (${bas})`, [{ ad: "Kalem", w: 72 }, { ad: "Tutar / Değer", w: 40, para: true }],
        ozetSatir.map((s) => typeof s[1] === "number" ? s : { cells: [s[0], s[1]] }), { filtresiz: true });
      const K7 = [{ ad: "Tarih", w: 12 }, { ad: "Kaynak İşlem No", w: 20 }, { ad: "Ödeyen Firma / Kasa", w: 26 }, { ad: "Kişi / Tedarikçi", w: 30 }, { ad: "Kategori", w: 20 }, { ad: "Açıklama", w: 56 }, { ad: "Saha / Proje", w: 18 }, { ad: "Tutar", w: 16, para: true }];
      sayfa("Şimşek'e Aktarılan Finansman", `${h.marka_ad} → Şimşek kasasına giren finansman (${bas}) — toplam ₺${o.finansman_simsek.toLocaleString("tr-TR")}`, K7,
        [...h.detay.finansman_simsek.map((k) => [trTarih(k.tarih), k.ref, `${h.marka_ad} → Şimşek kasası`, "", "Kasa girişi", k.aciklama, "", para(k.tutar)]), { cells: ["", "", "", "", "TOPLAM", "", "", o.finansman_simsek], bold: true }]);
      sayfa("Kendi Kasa ve Ödemeleri", `${h.marka_ad}'ın kendi kasasından yaptığı ödemeler (${bas}) — toplam ₺${o.firma_odeme.toLocaleString("tr-TR")} · eşleşen ₺${h.mutabakat.firma_eslesen.toLocaleString("tr-TR")}`,
        [...K7, { ad: "Eşleşen Ödeme Kaydı", w: 34 }, { ad: "Eşleşme", w: 14 }],
        [...h.detay.firma_odeme.map((k) => [trTarih(k.tarih), k.ref, `${h.marka_ad} kendi hesabı`, k.eslesen_odeme?.kisi || "", "Firma kasa girişi", k.aciklama, "", para(k.tutar),
          k.eslesen_odeme ? `${k.eslesen_odeme.ref} · ${trTarih(k.eslesen_odeme.tarih)} · ₺${k.eslesen_odeme.tutar.toLocaleString("tr-TR")}` : "—", k.eslesen_odeme ? "Eşleşti" : "EŞLEŞMEDİ"]),
          { cells: ["", "", "", "", "TOPLAM", "", "", o.firma_odeme, `eşleşen ₺${h.mutabakat.firma_eslesen.toLocaleString("tr-TR")}`, `fark ₺${h.mutabakat.fark.toLocaleString("tr-TR")}`], bold: true }]);
      sayfa("Operasyon Ödemeleri", `Gerçekleşmiş operasyon ödemeleri (${bas}) — toplam ₺${o.toplam_odeme.toLocaleString("tr-TR")} · Şimşek üzerinden ₺${o.simsek_odeme.toLocaleString("tr-TR")} · kendi kasası ₺${o.firma_odeme.toLocaleString("tr-TR")}`,
        [...K7, { ad: "Ödeme Yöntemi", w: 16 }],
        [...h.detay.toplam_odeme.map((x) => [trTarih(x.tarih), x.ref, x.odeyen_kasa === "FIRMA" ? `${h.marka_ad} kendi hesabı` : "Proje kasası (Şimşek)", x.kisi || "", x.tip, x.aciklama || "", [x.plaka, x.donem, x.fatura_no].filter(Boolean).join(" · "), para(x.tutar), x.odeme_yontemi || ""]),
          { cells: ["", "", "", "", "TOPLAM", "", "", o.toplam_odeme, ""], bold: true },
          { cells: ["", "", "", "", "Şimşek üzerinden", "", "", o.simsek_odeme, ""], bold: true }, { cells: ["", "", "", "", `${h.marka_ad} kendi kasası`, "", "", o.firma_odeme, ""], bold: true }]);
      const KA = [{ ad: "Talep No", w: 10 }, { ad: "Kişi", w: 28 }, { ad: "Firma", w: 10 }, { ad: "Açıklama", w: 48 }, { ad: "Bölge / Proje", w: 18 }, { ad: "Talep Tarihi", w: 12 }, { ad: "Direktör Onay Tarihi", w: 14 }, { ad: "Onaylayan", w: 26 }, { ad: "Onaylanan", w: 14, para: true }, { ad: "Ödenen", w: 14, para: true }, { ad: "Kalan (rezerv)", w: 14, para: true }];
      const avSat = (a) => [a.talep_no, a.kisi, a.firma, a.aciklama, [a.bolge, a.proje].filter(Boolean).join(" / "), trTarih(a.talep_tarihi), trTarih(a.onay_tarihi), a.onaylayan_ad, para(a.onaylanan), para(a.odenen), para(a.kalan)];
      sayfa("Onaylı Ödenmemiş Avanslar", `Onaylı ve ödenmemiş iş avansları (kesim ${kesimTR}) — rezerv ₺${o.rezerv.toLocaleString("tr-TR")}`, KA,
        [...h.detay.rezerv.map(avSat), { cells: ["", "", "", "REZERV TOPLAMI", "", "", "", "", "", "", o.rezerv], bold: true },
          ...(h.detay.rezerv_disi.length ? [{ cells: ["", "", "", "Belirlenen onaycıya ait olmayan bekleyen onaylar (rezerve girmez)", "", "", "", "", "", "", o.rezerv_disi], bold: true }, ...h.detay.rezerv_disi.map(avSat)] : [])]);
      const TIP_AD = { BORC: "Borç verildi", ODEME: "Geri ödeme", BORC_IPTAL: "Ters kayıt (borç iptali)", ODEME_IPTAL: "Ters kayıt (geri ödeme iptali)" };
      sayfa("Şimşek Borç Hareketleri", `Şimşek'e verilen borç ve geri ödemeler (${bas}) — anapara ₺${o.borc_anapara.toLocaleString("tr-TR")} · geri ₺${o.borc_geri.toLocaleString("tr-TR")} · kalan ₺${o.borc_kalan.toLocaleString("tr-TR")}`,
        [{ ad: "Tarih", w: 12 }, { ad: "Kayıt No", w: 12 }, { ad: "Hareket", w: 26 }, { ad: "Kaynak", w: 14 }, { ad: "Kasa Etkisi", w: 22 }, { ad: "Paranın Geldiği / Gittiği Hesap", w: 26 }, { ad: "Açıklama", w: 70 }, { ad: "Tutar", w: 16, para: true }, { ad: "Giren", w: 24 }],
        [...h.detay.borc.map((b) => [trTarih(b.tarih), `marka_borc #${b.id}`, TIP_AD[b.tip] || b.tip, b.kaynak, b.kasa_hareketi ? (b.tip.startsWith("BORC") ? "Proje kasasından çıktı" : "Proje kasasına girdi") : "Kasa dışı (yalnız defter)",
          b.hesap === "FIRMA_HESABI" ? `${h.marka_ad} hesabı` : b.hesap === "PROJE_KASASI" || b.kasa_hareketi ? "Proje kasası" : "—", b.aciklama, para(b.tutar) * (b.tip.endsWith("IPTAL") ? -1 : 1), b.olusturan || ""]),
          { cells: ["", "", "KALAN BORÇ", "", "", "", "", o.borc_kalan, ""], bold: true }]);
      sayfa("Mutabakat Kontrolü", `Mutabakat kontrolü (${bas}) — her toplam ekrandaki hesapla aynı kaynaktan`, [{ ad: "Kontrol", w: 78 }, { ad: "Hesaplanan", w: 18, para: true }, { ad: "Beklenen", w: 18, para: true }, { ad: "Sonuç", w: 12 }],
        [...h.mutabakat.kontroller.map((k) => [k.ad, k.sol, k.sag, k.ok ? "OK" : "FARK"]),
          ["Fon dışı işaretli ödemeler (hesap dışı, bilgi)", o.fon_disi, o.fon_disi, "bilgi"],
          ...(h.detay.firma_odeme.filter((k) => !k.eslesen_odeme).map((k) => [`Eşleşmeyen firma kasa girişi: ${k.ref} · ${trTarih(k.tarih)} · ${k.aciklama}`, k.tutar, 0, "FARK"]))], { filtresiz: true });
      const fname = `${h.marka}_Finansman_Mutabakat_${h.kesim_gun}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
      await wb.xlsx.write(res); res.end();
    } catch (e) { console.error("MUTABAKAT EXCEL:", e.message); hata(res, e.http || 500, e.http ? e.message : "Excel üretilemedi"); }
  });

  return { hesapla, kasaKaynagi: (row, P) => kasaKaynagi(row, P) };
}

module.exports = { semaKur, kur, kasaKaynagi, KASA_KAYNAK, BORC_TIPLERI, MUTABAKAT_ROLLER };
