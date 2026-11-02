#!/usr/bin/env node
// ═══ 1 KASIM 2026 SONRASI PLAN → MOBİL ATAMA DENETİMİ (02.11.2026, Orhan) ═══════════════════════════════════════════
// SALT OKUNUR önizleme (varsayılan). Teknocenter planlarının (plan_kayit / is_atama, 01.11.2026 ve sonrası) mobil atama durumunu
// kimlikleriyle listeler:
//   A) üyesinin mobil hesabı olmayan atamalar (personeller boş / e-postasız / users'ta yok / pasif)
//   B) mükerrer aktif atama (aynı iş kodu birden çok açık atamada)
//   C) yanlış ekibe bağlı (atamadaki personeller ekibin güncel üyeleriyle uyuşmuyor; ekip_uyelik geçmişi dikkate alınır)
//   D) 1 Kasım'dan önce başlayıp sonrasında devam eden aktif işler (geçmiş yeniden yazılmaz; devam eden iş olarak bağlanır)
//   E) geçmiş tarihli, hâlâ açık planlar (mobilde "Geciken / devam eden" bölümünde kalır — kayıp yok)
// Plan tarihi gerçekleşme kanıtı değildir: bu araç başlama / tamamlama ÜRETMEZ.
// --uygula : yalnız A sınıfındaki "ekip üyesinde hesap var ama personeller listesinde yok" durumunu düzeltir (personeller'e ekler);
//            önce yedek tablo (yedek_is_atama_personeller_<tarih>), islem_gecmisi kaydı. Tekrar çalıştırılabilir, geri alınabilir.
// Kullanım: node scripts/plan_atama_denetim.js [--bas 2026-11-01] [--uygula] [--excel dosya.xlsx]
"use strict";
const path = require("path");
const { Pool } = require(require.resolve("pg", { paths: [path.join(__dirname, "..")] }));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true) : d; };
const BAS = arg("--bas", "2026-11-01"), UYGULA = arg("--uygula", false) === true, EXCEL = arg("--excel", null);
const pool = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 }
  : { host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 55499), user: process.env.DB_USER || "postgres", database: process.env.DB_NAME || "erc_malzeme_plan", max: 1 });
const MONTAJ = ["NEW_SITE", "ENH_MONTAJ", "POWER", "GIZLEME", "MW", "GPS", "ISSUE"];

(async () => {
  const q = (s, p) => pool.query(s, p).then((r) => r.rows);
  const teknoRx = /^(TEKNO|TEKNOCENTER)([^A-Z0-9ÇĞİÖŞÜ]|$)/;
  const ekipler = await q(`SELECT e.ekip_no, e.ad, e.ekip_turu, e.bagli_firma, s.subcon_name AS firma_adi FROM ekipler e LEFT JOIN subcons s ON s.id = e.firma_id`);
  const teknoEkip = new Map(ekipler.filter((e) => (String(e.ekip_turu || "").toUpperCase() === "IC" ? String(e.bagli_firma || "").toUpperCase() === "TEKNO" : teknoRx.test(String(e.firma_adi || "").toUpperCase()))).map((e) => [Number(e.ekip_no), e]));
  const uyeler = await q(`SELECT id, ad_soyad, LOWER(TRIM(email)) AS email, TRIM(ekip_bilgisi) AS ekip FROM personel WHERE COALESCE(aktif,true)`);
  const users = new Map((await q(`SELECT LOWER(TRIM(email)) AS email, is_active, status FROM users`)).map((u) => [u.email, u]));
  const aktifHesap = (e) => { const u = users.get(e); return !!u && u.is_active !== false && String(u.status || "active") === "active"; };
  const atamalar = await q(`SELECT a.id, a.kategori, a.durum, a.site_codes, a.personeller, to_char(a.plan_tarihi,'YYYY-MM-DD') AS plan_tarihi, a.plan_baslangic, a.plan_bitis, a.ekip_no, a.plan_id,
      a.baslama_ts, a.bitis_ts, a.created_at, to_jsonb(a)->>'iptal_nedeni' AS iptal_nedeni FROM is_atama a
    WHERE a.kategori = ANY($1) AND (a.plan_tarihi >= $2::date OR a.plan_bitis >= $2::date OR (a.durum NOT IN ('TAMAMLANDI','IPTAL') AND a.created_at < $2::date)) ORDER BY a.id`, [MONTAJ, BAS]);
  const tekno = atamalar.filter((a) => a.ekip_no && teknoEkip.has(Number(a.ekip_no)));
  const bugun = new Date().toISOString().slice(0, 10);
  const A = [], B = [], C = [], D = [], E = [], duzeltmeler = [];
  const kodSayac = new Map();
  for (const a of tekno) {
    const ekip = teknoEkip.get(Number(a.ekip_no));
    const kodlar = (a.site_codes || []).map((s) => String(s).replace(/\s+/g, "").toUpperCase());
    const acik = !["TAMAMLANDI", "IPTAL"].includes(a.durum);
    const pers = Array.isArray(a.personeller) ? a.personeller.map((p) => String(p?.email || "").toLowerCase().trim()).filter(Boolean) : [];
    const ekipUye = uyeler.filter((u) => u.ekip === String(a.ekip_no));
    // A) ulaşım
    const ulasan = pers.filter(aktifHesap), ulasmayan = pers.filter((e) => !aktifHesap(e));
    const eksikUye = ekipUye.filter((u) => u.email && aktifHesap(u.email) && !pers.includes(u.email));
    if (acik && (!ulasan.length || ulasmayan.length || eksikUye.length)) {
      A.push({ atama: a.id, is: kodlar.join(","), ekip: ekip.ad, plan: a.plan_tarihi, durum: a.durum, ulasan: ulasan.join(";") || "—", ulasmayan: ulasmayan.join(";") || "—",
        ekipte_hesabi_var_ama_atamada_yok: eksikUye.map((u) => `${u.ad_soyad} <${u.email}>`).join(";") || "—",
        oneri: !ulasan.length ? (eksikUye.length ? "personeller'e ekip üyeleri eklenmeli (--uygula)" : "ekipte mobil hesabı olan kimse yok — hesap açılmalı / ekip kaydı düzeltilmeli") : eksikUye.length ? "eksik üyeler eklenebilir (--uygula)" : "pasif hesap: kontrol" });
      if (eksikUye.length) duzeltmeler.push({ id: a.id, ekle: eksikUye.map((u) => ({ email: u.email, ad: u.ad_soyad })), onceki: a.personeller });
    }
    // B) mükerrer
    if (acik) for (const k of kodlar) (kodSayac.get(k) || kodSayac.set(k, []).get(k)).push(a.id);
    // C) ekip uyumsuzluğu: atamadaki e-postalar ekibin güncel üyesi değil (ekip_uyelik geçmişinde o tarihte üye idiyse yanlış değil)
    if (acik && ekipUye.length) {
      const ekipMail = new Set(ekipUye.map((u) => u.email).filter(Boolean));
      const disari = pers.filter((e) => !ekipMail.has(e));
      if (disari.length) {
        const gecmis = await q(`SELECT 1 FROM ekip_uyelik eu JOIN personel p ON p.id = eu.personel_id WHERE eu.ekip_no = $1 AND LOWER(TRIM(p.email)) = ANY($2::text[]) AND eu.baslangic <= $3::date AND (eu.bitis IS NULL OR eu.bitis >= $3::date)`, [a.ekip_no, disari, a.plan_tarihi || bugun]).catch(() => []);
        C.push({ atama: a.id, is: kodlar.join(","), ekip: ekip.ad, plan: a.plan_tarihi, atamada_olup_ekipte_olmayan: disari.join(";"), uyelik_gecmisi_onayliyor: gecmis.length ? "evet (eski üye, bildirimleri korunur)" : "hayır — güncel yetkili personele göre yeniden değerlendirilmeli" });
      }
    }
    // D) 1 Kasım öncesi başlayıp devam eden
    if (acik && a.baslama_ts && new Date(a.baslama_ts) < new Date(`${BAS}T00:00:00+03:00`)) D.push({ atama: a.id, is: kodlar.join(","), ekip: ekip.ad, baslama: a.baslama_ts, durum: a.durum, not: "devam eden iş — geçmiş yeniden yazılmaz, mobilde açık kalır" });
    // E) geciken
    if (acik && a.plan_tarihi && a.plan_tarihi < bugun && !a.baslama_ts) E.push({ atama: a.id, is: kodlar.join(","), ekip: ekip.ad, plan: a.plan_tarihi, not: "plan tarihi geçti, başlanmadı — mobilde 'Geciken' bölümünde; otomatik başlama/tamamlama ÜRETİLMEZ" });
  }
  for (const [k, ids] of kodSayac) if (ids.length > 1) B.push({ is: k, atamalar: ids.join(","), oneri: "yalnız biri aktif kalmalı (yetkili karar verir; ekip değiştir / iptal uçlarıyla)" });
  const ozet = { donem_baslangici: BAS, tekno_ekip_sayisi: teknoEkip.size, incelenen_atama: tekno.length, A_ulasim_sorunu: A.length, B_mukerrer: B.length, C_ekip_uyumsuz: C.length, D_1kasim_oncesi_devam: D.length, E_geciken: E.length, uygulanabilir_duzeltme: duzeltmeler.length };
  console.log("== ÖZET"); console.table([ozet]);
  for (const [ad, l] of [["A) Ulaşım sorunu", A], ["B) Mükerrer aktif atama", B], ["C) Ekip uyumsuzluğu", C], ["D) 1 Kasım öncesi başlayıp devam eden", D], ["E) Geciken (başlanmamış, tarihi geçmiş)", E]]) { console.log(`== ${ad} (${l.length})`); if (l.length) console.table(l.slice(0, 50)); }
  if (EXCEL) {
    const ExcelJS = require(require.resolve("exceljs", { paths: [path.join(__dirname, "..")] }));
    const wb = new ExcelJS.Workbook();
    for (const [ad, l] of [["Özet", [ozet]], ["A Ulaşım", A], ["B Mükerrer", B], ["C Ekip uyumsuz", C], ["D Devam eden", D], ["E Geciken", E]]) {
      const ws = wb.addWorksheet(ad, { views: [{ showGridLines: false }] }); if (!l.length) { ws.addRow(["kayıt yok"]); continue; }
      ws.addRow(Object.keys(l[0])).font = { bold: true }; for (const r of l) ws.addRow(Object.values(r).map((v) => (v instanceof Date ? v.toISOString() : v)));
    }
    await wb.xlsx.writeFile(EXCEL); console.log("Excel:", EXCEL);
  }
  if (UYGULA) {
    if (!duzeltmeler.length) { console.log("Uygulanacak düzeltme yok."); }
    else {
      const yedek = `yedek_is_atama_personeller_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(`CREATE TABLE IF NOT EXISTS ${yedek} (is_atama_id INTEGER, personeller JSONB, zaman TIMESTAMPTZ DEFAULT now())`);
        for (const d of duzeltmeler) {
          await c.query(`INSERT INTO ${yedek} (is_atama_id, personeller) VALUES ($1, $2)`, [d.id, JSON.stringify(d.onceki || [])]);
          const yeni = [...(Array.isArray(d.onceki) ? d.onceki : []), ...d.ekle];
          await c.query(`UPDATE is_atama SET personeller = $2::jsonb, updated_at = NOW() WHERE id = $1`, [d.id, JSON.stringify(yeni)]);
          await c.query(`INSERT INTO islem_gecmisi (modul, kayit_id, tip, eski, yeni, yapan_email, aciklama) VALUES ('is_atama', $1, 'DUZENLEME', $2, $3, 'plan_atama_denetim', 'Mobil ulaşım düzeltmesi: ekip üyeleri personeller listesine eklendi')`,
            [d.id, JSON.stringify({ personeller: d.onceki }), JSON.stringify({ personeller: yeni })]).catch(() => {});
        }
        await c.query("COMMIT"); console.log(`Uygulandı: ${duzeltmeler.length} atama; yedek tablo ${yedek}. Geri dönüş: UPDATE is_atama a SET personeller = y.personeller FROM ${yedek} y WHERE y.is_atama_id = a.id;`);
      } catch (e) { await c.query("ROLLBACK"); console.error("HATA, geri alındı:", e.message); } finally { c.release(); }
    }
  } else if (duzeltmeler.length) console.log(`\n${duzeltmeler.length} atama için düzeltme hazır — yalnız --uygula ile ve Orhan onayıyla.`);
  await pool.end();
})().catch((e) => { console.error("HATA:", e.message); process.exit(1); });
