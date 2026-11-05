// ═══ ARAÇ – İŞ İLİŞKİ ÇÖZÜMLEYİCİSİ (05.11.2026, Orhan) ═══════════════════════════════════════════════════════════
// Araç kartı, Bugünkü / Haftalık Plan, Ekip ve Personel, malzeme ve sayaçlar bir işin bu araçla ilişkisini TEK yerden alır.
// Kök neden (05.11.2026, 63AKR853 / ENDER TEKE): Rollout İş Ata'da işler çoğu zaman yalnız kişiye atanıyor (personeller JSON,
// e-posta); ekip_no ve arac_plaka boş kalıyor. Araç paneli yalnız plakası dolu atamalara baktığı için kişiye atanmış işler
// (#69, #76, #77) hiç görünmüyordu.
//
// İlişki kaynakları (ayrı tutulur, yanıtta taşınır):
//   A  DOĞRULANMIŞ — atamada ya da Weekly Plan segmentinde AÇIK araç plakası (ATAMA_PLAKA / SEGMENT_PLAKA)
//   B  DOĞRULANMIŞ — işin gününde geçerli, tarihli araç tahsisi (arac_tahsis: personel ya da ekip → araç, bas–bit) (TAHSIS)
//   C  ADAY (teyit bekliyor) — tarihsiz / dolaylı bağlar; geçmişe dönük kesin araç kullanımı SAYILMAZ:
//        ORG_ARAC_ATAMASI  personel.ekip_arac_plaka (org şeması kişi–araç ataması; güncel, tarihsiz)
//        KART_SURUCU       araclar.surucu metni → personel kaydıyla TEKİL ad eşleşmesi (belirsiz ad eşleşmesi kullanılmaz)
//        EKIP_AYNI_GUN     işin ekibi aynı gün bu araçla açık plakalı planda (işte araç yazılmamış)
//        EKIP_ADAY_KISI    işin ekibi, aday kişinin güncel ekibi (personel.ekip_bilgisi)
// Kurallar: işte başka araç açıkça yazılıysa iş bu araca TAŞINMAZ. Kişi o gün tarihli tahsisle başka araçtaysa aday olmaz.
// Birden fazla olası araç / tahsis varsa "Bağlantı belirsiz". Kişiler kalıcı kimlikle (personel id ↔ e-posta) eşleşir.
"use strict";

const plakaNorm = (p) => String(p || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
const katla = (s) => String(s || "").trim().toLocaleUpperCase("tr-TR").replace(/İ/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G").replace(/Ü/g, "U")
  .replace(/Ö/g, "O").replace(/Ç/g, "C").replace(/[^A-Z0-9]+/g, " ").trim();
const ACIK_DEGIL = ["TAMAMLANDI", "IPTAL"];
const KAYNAK_AD = {
  ATAMA_PLAKA: "Atamada araç plakası", SEGMENT_PLAKA: "Weekly Plan segmentinde araç plakası", TAHSIS: "Tarihli araç tahsisi",
  ORG_ARAC_ATAMASI: "Personelin org şemasındaki araç ataması (tarihsiz)", KART_SURUCU: "Araç kartındaki sürücü (tarihsiz)",
  EKIP_AYNI_GUN: "Ekip aynı gün bu araçla planlı; işte araç yazılmamış", EKIP_ADAY_KISI: "Ekip, aday sürücünün güncel ekibi",
};

// Araç kartı sürücü metni → personel: yalnız TEKİL tam ad eşleşmesi (katlanmış). 0 ya da >1 eşleşme → null + neden
function surucuEslestir(surucu, personel) {
  const s = katla(surucu);
  if (!s) return { personel: null, neden: "Araç kartında sürücü yok" };
  const es = personel.filter((p) => p.aktif !== false && katla(p.ad_soyad) === s);
  if (es.length === 1) return { personel: es[0], neden: null };
  return { personel: null, neden: es.length ? `"${surucu}" adıyla ${es.length} personel var — belirsiz, eşleştirilmedi` : `"${surucu}" personel kaydıyla eşleşmedi` };
}

const tahsisGecerli = (t, gun) => !t.iptal && String(t.bas) <= gun && (!t.bit || String(t.bit) >= gun);

// girdi:
//   arac        { id, plaka, surucu }
//   bas, bit    görünüm aralığı (TR günleri)
//   atamalar    is_atama satırları (bas_gun, bit_gun, plaka_n, seg_plakalar[], seg_ekipler[], ekip_no, personeller[], durum, id)
//   personel    [{ id, email, ad_soyad, ekip_bilgisi, ekip_arac_plaka, aktif }] (kapsamdaki)
//   tahsisler   [{ id, arac_id, plaka_n, personel_id, ekip_no, bas, bit, iptal }]
//   araclar     [{ id, plaka_n, surucu }] — belirsizlik denetimi için tüm araçlar
// çıktı: { isler: [{ x, zaman: GUNDE|DEVREDEN, grup: DOGRULANMIS|ADAY|BELIRSIZ, kaynaklar[], aciklama }], adaylar, dogruEkipler, notlar }
function iliskiCoz({ arac, bas, bit, atamalar = [], personel = [], tahsisler = [], araclar = [] }) {
  const V = plakaNorm(arac.plaka);
  const emailId = new Map(personel.filter((p) => p.email).map((p) => [String(p.email).toLowerCase().trim(), p]));
  const pById = new Map(personel.map((p) => [Number(p.id), p]));
  // Aday kişiler (C): org şeması araç ataması + araç kartı sürücüsü (tekil)
  const adayKisi = new Map(); // personel id → { p, kaynaklar }
  const ekle = (p, k) => { if (!p) return; const v = adayKisi.get(Number(p.id)) || { p, kaynaklar: [] }; if (!v.kaynaklar.includes(k)) v.kaynaklar.push(k); adayKisi.set(Number(p.id), v); };
  for (const p of personel) if (p.aktif !== false && plakaNorm(p.ekip_arac_plaka) === V && V) ekle(p, "ORG_ARAC_ATAMASI");
  const sur = surucuEslestir(arac.surucu, personel);
  if (sur.personel) ekle(sur.personel, "KART_SURUCU");
  // Belirsizlik: aday kişinin başka araçla da tarihsiz bağı var mı (org ataması ya da başka aracın kart sürücüsü)
  const baskaAraclar = (p) => {
    const s = new Set();
    if (plakaNorm(p.ekip_arac_plaka) && plakaNorm(p.ekip_arac_plaka) !== V) s.add(plakaNorm(p.ekip_arac_plaka));
    for (const a of araclar) if (a.plaka_n !== V && a.surucu && katla(a.surucu) === katla(p.ad_soyad)) s.add(a.plaka_n);
    return [...s];
  };
  const kisiler = (x) => {
    const out = [];
    for (const k of Array.isArray(x.personeller) ? x.personeller : []) {
      const p = (k?.personel_id && pById.get(Number(k.personel_id))) || emailId.get(String(k?.email || "").toLowerCase().trim());
      if (p && !out.includes(p)) out.push(p);
    }
    return out;
  };
  const gunde = (x) => String(x.bas_gun) <= bit && String(x.bit_gun || x.bas_gun) >= bas;
  const devreden = (x) => String(x.bit_gun || x.bas_gun) < bas && !ACIK_DEGIL.includes(String(x.durum || "").toUpperCase());
  const acikPlakalar = (x) => { const s = new Set(); if (x.plaka_n) s.add(x.plaka_n); for (const p of x.seg_plakalar || []) if (p) s.add(p); return s; };
  // A: açık plakayla bu aracı kullanan ekipler (gün bazında; EKIP_AYNI_GUN için)
  const ekipGun = new Map(); // `${ekip}|${gun}`
  const gunleri = (x) => { const l = []; for (let g = String(x.bas_gun); g <= String(x.bit_gun || x.bas_gun) && l.length < 62; g = new Date(Date.parse(`${g}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)) l.push(g); return l; };
  for (const x of atamalar) if (acikPlakalar(x).has(V)) for (const g of gunleri(x)) { if (x.ekip_no) ekipGun.set(`${Number(x.ekip_no)}|${g}`, true); for (const e of x.seg_ekipler || []) ekipGun.set(`${Number(e)}|${g}`, true); }
  const isler = [], dogruEkipler = new Set();
  for (const x of atamalar) {
    if (String(x.durum || "").toUpperCase() === "IPTAL") continue;
    const zaman = gunde(x) ? "GUNDE" : devreden(x) ? "DEVREDEN" : null;
    if (!zaman) continue; // gelecek işler bu görünüme girmez
    const P = acikPlakalar(x);
    // A — açık plaka
    if (P.size) {
      if (!P.has(V)) continue; // başka araç açıkça yazılı → taşınmaz
      const kaynaklar = [x.plaka_n === V ? "ATAMA_PLAKA" : "SEGMENT_PLAKA"];
      const grup = P.size > 1 ? "BELIRSIZ" : "DOGRULANMIS";
      isler.push({ x, zaman, grup, kaynaklar, aciklama: P.size > 1 ? `Atamada birden fazla araç: ${[...P].join(", ")}` : null });
      if (grup === "DOGRULANMIS") { if (x.ekip_no) dogruEkipler.add(Number(x.ekip_no)); (x.seg_ekipler || []).forEach((e) => dogruEkipler.add(Number(e))); }
      continue;
    }
    // B — tarihli tahsis (işin bu görünümdeki ilk günü; devredende son günü)
    const gun = zaman === "GUNDE" ? [String(x.bas_gun), bas].sort().pop() : String(x.bit_gun || x.bas_gun);
    const ks = kisiler(x);
    const ilgiliTahsis = tahsisler.filter((t) => tahsisGecerli(t, gun) && ((t.personel_id && ks.some((p) => Number(p.id) === Number(t.personel_id))) || (t.ekip_no && x.ekip_no && Number(t.ekip_no) === Number(x.ekip_no))));
    const tAraclar = [...new Set(ilgiliTahsis.map((t) => t.plaka_n))];
    if (tAraclar.length) {
      if (!tAraclar.includes(V)) continue; // kişi / ekip o gün tahsisle başka araçta
      isler.push({ x, zaman, grup: tAraclar.length > 1 ? "BELIRSIZ" : "DOGRULANMIS", kaynaklar: ["TAHSIS"], tahsis_id: ilgiliTahsis.find((t) => t.plaka_n === V)?.id || null,
        aciklama: tAraclar.length > 1 ? `Aynı gün birden fazla araç tahsisi: ${tAraclar.join(", ")}` : null });
      if (tAraclar.length === 1 && x.ekip_no) dogruEkipler.add(Number(x.ekip_no));
      continue;
    }
    // C — aday bağlar
    const kaynaklar = [], adaylar = [];
    for (const p of ks) { const a = adayKisi.get(Number(p.id)); if (a) { for (const k of a.kaynaklar) if (!kaynaklar.includes(k)) kaynaklar.push(k); adaylar.push(p); } }
    if (x.ekip_no && gunleri(x).some((g) => ekipGun.has(`${Number(x.ekip_no)}|${g}`))) kaynaklar.push("EKIP_AYNI_GUN");
    if (x.ekip_no && [...adayKisi.values()].some((a) => String(a.p.ekip_bilgisi || "").trim() === String(x.ekip_no))) kaynaklar.push("EKIP_ADAY_KISI");
    if (!kaynaklar.length) continue;
    const digerleri = [...new Set(adaylar.flatMap(baskaAraclar))];
    isler.push({ x, zaman, grup: digerleri.length ? "BELIRSIZ" : "ADAY", kaynaklar,
      aciklama: digerleri.length ? `Bağlantı belirsiz: aday personel başka araçla da ilişkili (${digerleri.join(", ")})` : null,
      aday_kisiler: adaylar.map((p) => ({ id: Number(p.id), ad: p.ad_soyad })) });
  }
  return {
    isler, dogruEkipler: [...dogruEkipler],
    adaylar: [...adayKisi.values()].map((a) => ({ id: Number(a.p.id), ad: a.p.ad_soyad, ekip_no: String(a.p.ekip_bilgisi || "").trim() || null, kaynaklar: a.kaynaklar,
      kaynak_ad: a.kaynaklar.map((k) => KAYNAK_AD[k]), baska_araclar: baskaAraclar(a.p) })),
    surucu_eslesme: { kart: arac.surucu || null, personel_id: sur.personel ? Number(sur.personel.id) : null, neden: sur.neden },
  };
}

module.exports = { iliskiCoz, surucuEslestir, plakaNorm, katla, KAYNAK_AD, tahsisGecerli };
