// Atama detayı (yönetici, 03.11.2026): atayan, not, kişiler / ekip, plan, fiilî durum, son bildirim, değişiklik geçmişi.
// İşlemler sunucu kurallarıyla: tarih / saat / not düzenle (plan_surum eşleşmeli), kişi değişikliği (başlanmamışsa), gerekçeli iptal,
// ekip / kişi değişikliği ve başlanmış işte "kalan işi devret" (eski ekibin gün kayıtları korunur). Tamamlanmış iş yeniden açılmaz.
import React, { useState } from "react";
import { Alert, Pressable, Switch, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { aralik, kose, renk } from "../tema";
import { BilgiSatiri, BolumBasligi, Buton, Kart, Metin, Rozet } from "../bilesenler/temel";
import { Bant, HataDurum, IskeletKart } from "../bilesenler/durum";
import { Alan, CipSecim, TarihAlani } from "../bilesenler/form";
import { Ekran } from "../bilesenler/Ekran";
import { Segment } from "./HarcamalarEkrani";
import { useGecersizKil, useVeri } from "../api/veri";
import { atamaApi } from "../api/uclar";
import { hataMetni } from "../mantik/hata";
import { durumBilgisi } from "../mantik/durumlar";
import { saat, tarih } from "../mantik/bicim";
import { ekiptenKisiler, kisiCikar, kisiEkle, tarihTR, zamanAyir, zamanBirlestir } from "../mantik/atama";

const PIN = { YESIL: "#16A34A", SARI: "#E0A21B", MAVI: "#2563EB", GRI: "#8A97A8" };
// QC bilgisi sunucudan metin ya da nesne ({ ad / durum / kod }) gelebilir — ham nesne ekrana basılmaz
const qcMetni = (q) => (!q ? null : typeof q === "string" ? q : q.ad || q.durum || q.kod || null);

export function IsAtamaDetayEkrani({ route, navigation }) {
  const id = route.params.id;
  const gecersizKil = useGecersizKil();
  const v = useVeri(`isAtama:${id}`, async () => (await atamaApi.detay(id)).row);
  const b = useVeri("isAtamaBaslangic", () => atamaApi.baslangic(), { odaktaYenile: false });
  const [panel, setPanel] = useState(null); // duzenle | kisi | iptal | devret
  const [bekle, setBekle] = useState(false);
  const r = v.veri;
  const yenile = () => { gecersizKil([`isAtama:${id}`]); v.yenile(); };
  const bitti = () => { gecersizKil(["isAtamaListe", "isler"]); yenile(); };

  const islem = async (fn, basari) => {
    if (bekle) return;
    setBekle(true);
    try { const s = await fn(); bitti(); setPanel(null); if (basari) Alert.alert(basari[0], typeof basari[1] === "function" ? basari[1](s) : basari[1]); return s; }
    catch (e) {
      if (e?.durumKodu === 409 && e?.govde?.plan_surum) Alert.alert("Kayıt değişmiş", "Bu atama bu arada başkası tarafından değiştirildi. Güncel kayıt yüklendi; değişikliğinizi tekrar yapın.", [{ text: "Tamam", onPress: yenile }]);
      else if (e?.durumKodu === 409 && e?.govde?.kalan_devir_gerekli) Alert.alert("Çalışma başlamış", `${e.message}`, [{ text: "Vazgeç", style: "cancel" }, { text: "Kalan işi devret", onPress: () => setPanel("devret") }]);
      else if (e?.durumKodu === 409 && e?.govde?.ulasim_onay_gerekli) Alert.alert("Mobil hesap yok", `${e.message}\n\nYine de devredilsin mi? (Atama bu kişilere ulaşmaz)`, [{ text: "Vazgeç", style: "cancel" }, { text: "Yine de devret", style: "destructive", onPress: () => fn({ ulasim_onay: true }).then(() => { bitti(); setPanel(null); }).catch((h) => Alert.alert("Olmadı", hataMetni(h))) }]);
      else if (e?.sonucBelirsiz) Alert.alert("Bağlantı sorunu", "İşlem sunucuya ulaşmamış olabilir. Güncel durum yenilendi; gerekiyorsa tekrar deneyin.", [{ text: "Tamam", onPress: yenile }]);
      else Alert.alert("İşlem yapılamadı", hataMetni(e));
    } finally { setBekle(false); }
  };

  if (!r) return <Ekran baslik={`Atama #${id}`} yenileniyor={v.yenileniyor} onYenile={v.yenile}>{v.hata ? <Kart><HataDurum hata={v.hata} onTekrar={v.yenile} /></Kart> : <><IskeletKart /><IskeletKart /></>}</Ekran>;
  const d = durumBilgisi("is", r.durum);
  const I = r.islemler || {};
  const z = r.plan_baslangic ? zamanAyir(r.plan_baslangic) : null, zb = r.plan_bitis ? zamanAyir(r.plan_bitis) : null;
  return (
    <Ekran baslik={(r.site_codes || []).join(", ") || r.konum_aciklama || r.kategori_ad} altBaslik={`#${r.id} · ${[r.kategori_ad || r.kategori, r.alt_tip].filter(Boolean).join(" · ")}`} yenileniyor={v.yenileniyor} onYenile={v.yenile} klavye
      alt={!panel && (I.duzenle || I.iptal || I.devret) ? (
        <View style={{ flexDirection: "row", gap: aralik.xs }}>
          {I.duzenle ? <Buton baslik="Düzenle" ikon="create-outline" tur="ikincil" kucuk onPress={() => setPanel("duzenle")} style={{ flex: 1 }} /> : null}
          {I.devret ? <Buton baslik={I.kalan_devir_gerekli ? "Kalan işi devret" : "Ekip değiştir"} ikon="swap-horizontal" tur="ikincil" kucuk onPress={() => setPanel("devret")} style={{ flex: 1.2 }} /> : null}
          {I.iptal ? <Buton baslik="İptal" ikon="close-circle-outline" tur="tehlike" kucuk onPress={() => setPanel("iptal")} style={{ flex: 0.8 }} /> : null}
        </View>) : null}>
      <Kart>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: aralik.xs }}>
          <Rozet metin={d.ad} tonAdi={d.ton} />
          {r.iptal_nedeni && r.iptal_nedeni !== "IPTAL" ? <Metin tur="minik" renk={renk.metinIkincil} style={{ marginLeft: aralik.xs }}>{r.iptal_nedeni === "KALAN_DEVIR" ? "kalan iş devredildi" : "başka ekibe aktarıldı"}{r.devir_hedef ? ` → #${r.devir_hedef}` : ""}</Metin> : null}
          {r.devir_kaynak ? <Metin tur="minik" renk={renk.metinIkincil} style={{ marginLeft: aralik.xs }}>#{r.devir_kaynak} atamasından devir</Metin> : null}
        </View>
        <BilgiSatiri etiket="Plan" deger={r.plan_tarihi ? (z ? `${tarihTR(z.gun)} · ${z.saat}–${zb?.saat || ""}` : `${tarihTR(String(r.plan_tarihi).slice(0, 10))} (gün)`) : "—"} />
        <BilgiSatiri etiket={r.ekip_ad ? "Ekip" : "Personel"} deger={[r.ekip_ad, (r.personeller || []).map((p) => p.ad || p.email).join(", ")].filter(Boolean).join(" · ") || (r.taseron ? `Taşeron: ${r.taseron.ad}` : "—")} />
        {r.arac_plaka ? <BilgiSatiri etiket="Araç" deger={r.arac_plaka} /> : null}
        <BilgiSatiri etiket="Atayan" deger={[r.atayan_ad, r.created_at ? `${tarih(r.created_at)} ${saat(r.created_at)}` : null].filter(Boolean).join(" · ")} />
        <BilgiSatiri etiket="Başlama" deger={r.baslama_ts ? `${tarih(r.baslama_ts)} ${saat(r.baslama_ts)}` : null} />
        <BilgiSatiri etiket="Bitiş" deger={r.bitis_ts ? `${tarih(r.bitis_ts)} ${saat(r.bitis_ts)}` : null} />
        <BilgiSatiri etiket="Weekly Plan" deger={r.planli ? "saatli blok" : "gün bazlı"} son />
        {r.atayan_not ? <Bant tonAdi="bilgi" baslik="Atayanın notu" metin={r.atayan_not} style={{ marginTop: aralik.s }} /> : null}
        {r.kapanis_not ? <Bant tonAdi="notr" baslik="Kapanış / işlem notu" metin={r.kapanis_not} style={{ marginTop: aralik.s }} /> : null}
        {r.ulasim && r.ulasim.eksik?.length ? <Bant tonAdi="uyari" metin={r.ulasim.mesaj} style={{ marginTop: aralik.s }} /> : null}
      </Kart>

      {panel === "duzenle" ? <DuzenlePaneli r={r} bekle={bekle} onVazgec={() => setPanel(null)} onKaydet={(g) => islem(() => atamaApi.guncelle(r.id, { ...g, plan_surum: r.plan_surum }), ["Kaydedildi", "Atama güncellendi; ekibin İşlerim ekranı ve Weekly Plan aynı kaydı gösterir."])} /> : null}
      {panel === "devret" ? <DevretPaneli r={r} ekipler={b.veri?.ekipler || []} kisiler={b.veri?.kisiler || []} bekle={bekle} onVazgec={() => setPanel(null)}
        onGonder={(g) => islem((ek) => atamaApi.devret(r.id, { ...g, ...(ek || {}), plan_surum: r.plan_surum }), ["Devredildi", (s) => `Yeni atama #${s?.yeni_atama_id}. ${(s?.uyarilar || []).join(" ")}`.trim()]).then((s) => { if (s?.yeni_atama_id) navigation.replace("IsAtamaDetay", { id: s.yeni_atama_id }); })} /> : null}
      {panel === "iptal" ? <IptalPaneli r={r} bekle={bekle} onVazgec={() => setPanel(null)} onGonder={(g) => islem(() => atamaApi.iptal(r.id, { ...g, plan_surum: r.plan_surum }), ["İptal edildi", "Atama ekibin aktif listesinden kalktı."])} /> : null}

      {(r.site_codes || []).length ? (
        <>
          <BolumBasligi baslik="Sahalar ve fiilî durum" />
          <Kart style={{ paddingVertical: aralik.xs }}>
            {(r.site_codes || []).map((sc, i) => {
              const f = r.fiili?.[sc], m = r.malzeme?.[sc], sb = (r.son_bildirimler || []).find((x) => x.site_code === sc);
              return (
                <View key={sc} style={{ flexDirection: "row", paddingVertical: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: renk.cizgi }}>
                  <View style={{ width: 4, borderRadius: 2, backgroundColor: PIN[f?.renk] || renk.cizgiKoyu, marginRight: aralik.s }} />
                  <View style={{ flex: 1 }}>
                    <Metin tur="govdeKalin">{sc}</Metin>
                    <Metin tur="kucuk" renk={renk.metinIkincil}>{f ? `${f.ad}${f.issue ? " · ⚠ issue açık" : ""}${qcMetni(f.qc) ? ` · QC ${qcMetni(f.qc)}` : ""}` : "Fiilî durum bilgisi yok"}</Metin>
                    {m ? <Metin tur="minik" renk={renk.metinSoluk}>Malzeme: {[m.etiket, m.konum_ad && m.konum_ad !== m.etiket ? m.konum_ad : null, m.ekipte?.length ? m.ekipte.join(", ") : null].filter(Boolean).join(" · ")}</Metin> : null}
                    {sb ? <Metin tur="minik" renk={renk.metinSoluk}>Son bildirim: {sb.olay}{sb.issue_turu ? ` (${sb.issue_turu})` : ""} · {sb.bildiren_ad || sb.bildiren_email} · {tarih(sb.created_at)} {saat(sb.created_at)}{sb.aciklama ? `\n"${sb.aciklama}"` : ""}</Metin> : null}
                  </View>
                </View>
              );
            })}
          </Kart>
        </>
      ) : null}

      {(r.gunler || []).length ? (
        <>
          <BolumBasligi baslik="Çalışma kayıtları" />
          <Kart style={{ paddingVertical: aralik.xs }}>
            {r.gunler.map((g, i) => <BilgiSatiri key={g.id || i} etiket={`${tarih(g.tarih)} · ${g.personel_ad || g.personel_email}`} deger={`${saat(g.baslama) || "—"} – ${saat(g.bitis) || "devam"}`} son={i === r.gunler.length - 1} />)}
          </Kart>
        </>
      ) : null}

      <BolumBasligi baslik="Değişiklik geçmişi" />
      <Kart style={{ paddingVertical: aralik.xs }}>
        {(r.gecmis || []).length ? r.gecmis.slice().reverse().map((g, i) => (
          <View key={g.id} style={{ paddingVertical: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: renk.cizgi }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Metin tur="kucukKalin" style={{ flex: 1 }}>{g.ad}</Metin>
              <Metin tur="minik" renk={renk.metinSoluk}>{tarih(g.zaman)} {saat(g.zaman)}</Metin>
            </View>
            <Metin tur="minik" renk={renk.metinIkincil}>{[g.kullanici, gecmisOzeti(g)].filter(Boolean).join(" · ")}</Metin>
          </View>
        )) : <Metin tur="kucuk" renk={renk.metinIkincil}>Kayıt yok</Metin>}
      </Kart>
    </Ekran>
  );
}

function gecmisOzeti(g) {
  const y = g.yeni || {}, e = g.eski || {};
  const p = [];
  if (y.gerekce) p.push(`gerekçe: ${y.gerekce}`);
  if (y.plan_tarihi && y.plan_tarihi !== e.plan_tarihi) p.push(`tarih → ${tarihTR(String(y.plan_tarihi).slice(0, 10))}`);
  if (y.plan_baslangic) { const a = zamanAyir(y.plan_baslangic), b = zamanAyir(y.plan_bitis); p.push(`${tarihTR(a.gun)} ${a.saat}–${b?.saat || ""}`); }
  if (y.yeni_atama_id) p.push(`yeni atama #${y.yeni_atama_id}`);
  if (y.ekip_no && !y.yeni_atama_id && y.ekip_no !== e.ekip_no) p.push(`ekip ${y.ekip_no}`);
  if (Array.isArray(y.personeller) && !y.yeni_atama_id && g.tip !== "OLUSTURMA") p.push(`kişiler: ${y.personeller.map((x) => x.ad || x).join(", ")}`);
  if (y.kanal) p.push(y.kanal);
  if (y.durum && g.tip === "IPTAL") p.push("iptal");
  if (y.atayan_not !== undefined && y.atayan_not !== e.atayan_not) p.push("not değişti");
  return p.join(" · ") || g.aciklama || "";
}

function DuzenlePaneli({ r, bekle, onVazgec, onKaydet }) {
  const z = r.plan_baslangic ? zamanAyir(r.plan_baslangic) : null, zb = r.plan_bitis ? zamanAyir(r.plan_bitis) : null;
  const [gun, setGun] = useState(r.plan_tarihi ? String(r.plan_tarihi).slice(0, 10) : "");
  const [saatli, setSaatli] = useState(!!z);
  const [bas, setBas] = useState(z?.saat || "08:30"), [bit, setBit] = useState(zb?.saat || "17:30");
  const [not, setNot] = useState(r.atayan_not || "");
  const [gerekce, setGerekce] = useState("");
  const [kisiler, setKisiler] = useState((r.personeller || []).map((p) => ({ email: String(p.email).toLowerCase(), ad: p.ad || p.email })));
  const enGec = new Date(); enGec.setFullYear(enGec.getFullYear() + 1);
  const kaydet = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(gun)) return Alert.alert("Eksik bilgi", "Planlanan tarihi seçin");
    if (saatli && bit <= bas) return Alert.alert("Eksik bilgi", "Bitiş saati başlangıçtan sonra olmalı");
    const g = { plan_tarihi: gun, atayan_not: not, gerekce, personeller: kisiler };
    if (saatli) { g.plan_baslangic = zamanBirlestir(gun, bas); g.plan_bitis = zamanBirlestir(gun, bit); } else if (z) g.saat_kaldir = true;
    onKaydet(g);
  };
  return (
    <Kart style={{ marginTop: aralik.s }}>
      <Metin tur="baslikM" style={{ fontWeight: "700", marginBottom: aralik.s }}>Düzenle</Metin>
      <TarihAlani etiket="Planlanan tarih" zorunlu deger={gun} onDegis={setGun} enGec={enGec} />
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: aralik.s }}><Metin tur="govde" style={{ flex: 1 }}>Saat belirle</Metin><Switch value={saatli} onValueChange={setSaatli} trackColor={{ true: renk.lacivert }} /></View>
      {saatli ? <View style={{ flexDirection: "row", gap: aralik.s }}><Alan etiket="Başlangıç" deger={bas} onDegis={(t) => setBas(saatDuzelt(t))} klavye="numbers-and-punctuation" style={{ flex: 1 }} /><Alan etiket="Bitiş" deger={bit} onDegis={(t) => setBit(saatDuzelt(t))} klavye="numbers-and-punctuation" style={{ flex: 1 }} /></View> : null}
      <Alan etiket="Atayan notu" cokSatir deger={not} onDegis={setNot} ipucu="Ekibin İşlerim detayında görünür" />
      {!r.islemler?.baslamis ? (
        <View style={{ marginBottom: aralik.m }}>
          <Metin tur="etiket" renk={renk.metinIkincil} style={{ marginBottom: 6 }}>Kişiler (başlanmamış iş)</Metin>
          {kisiler.map((p) => (
            <View key={p.email} style={{ flexDirection: "row", alignItems: "center", minHeight: 40 }}>
              <Metin tur="govde" style={{ flex: 1 }}>{p.ad}</Metin>
              <Pressable onPress={() => setKisiler(kisiCikar(kisiler, p.email))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${p.ad} çıkar`}><Ionicons name="remove-circle-outline" size={22} color={renk.hata} /></Pressable>
            </View>
          ))}
          <Metin tur="minik" renk={renk.metinSoluk}>Kişi eklemek ya da ekip değiştirmek için "Ekip değiştir" kullanın.</Metin>
        </View>
      ) : <Bant tonAdi="bilgi" metin={'Çalışma başlamış: kişi değişikliği yalnız gerekçeli "Kalan işi devret" ile yapılır; önceki gün kayıtları silinmez.'} style={{ marginBottom: aralik.m }} />}
      <Alan etiket="Değişiklik gerekçesi" deger={gerekce} onDegis={setGerekce} ipucu="İsteğe bağlı; geçmişe yazılır" />
      <View style={{ flexDirection: "row", gap: aralik.s }}>
        <Buton baslik="Vazgeç" tur="ikincil" onPress={onVazgec} style={{ flex: 1 }} />
        <Buton baslik="Kaydet" onPress={kaydet} yukleniyor={bekle} style={{ flex: 1.4 }} />
      </View>
    </Kart>
  );
}
const saatDuzelt = (t) => { const d = String(t || "").replace(/[^\d]/g, "").slice(0, 4); return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d; };

function DevretPaneli({ r, ekipler, kisiler, bekle, onVazgec, onGonder }) {
  const basladi = !!r.islemler?.baslamis;
  const [mod, setMod] = useState("ekip");
  const [ekipNo, setEkipNo] = useState(null);
  const [secilen, setSecilen] = useState([]);
  const [gerekce, setGerekce] = useState("");
  const [q, setQ] = useState("");
  const n = q.trim().toLocaleLowerCase("tr-TR");
  const gonder = () => {
    if (gerekce.trim().length < 3) return Alert.alert("Gerekçe gerekli", basladi ? "Kalan işi devretme gerekçesini yazın" : "Ekip değişikliği gerekçesini yazın");
    if (mod === "ekip" && ekipNo == null) return Alert.alert("Eksik bilgi", "Yeni ekibi seçin");
    if (mod === "kisi" && !secilen.length) return Alert.alert("Eksik bilgi", "En az bir personel seçin");
    const g = { gerekce: gerekce.trim(), kalan_devir: basladi };
    if (mod === "ekip") g.yeni_ekip_no = ekipNo; else g.yeni_personeller = secilen;
    onGonder(g);
  };
  return (
    <Kart style={{ marginTop: aralik.s }}>
      <Metin tur="baslikM" style={{ fontWeight: "700" }}>{basladi ? "Kalan işi devret" : "Ekip / kişi değiştir"}</Metin>
      <Metin tur="kucuk" renk={renk.metinIkincil} style={{ marginBottom: aralik.s }}>
        {basladi ? `Bu işte çalışma başlamış (${r.durum}, ${(r.gunler || []).length} gün kaydı). Önceki kayıtlar silinmez; kalan iş yeni ekibe gerekçeli devredilir.` : "Başlanmamış iş: eski ekibin aktif listesinden kalkar, yeni ekibe gelir. Malzeme devri oluşturmaz."}
      </Metin>
      <Segment secenekler={[{ id: "ekip", ad: "Ekip" }, { id: "kisi", ad: "Tek tek personel" }]} deger={mod} onSec={setMod} />
      {mod === "ekip" ? ekipler.map((e) => {
        const sec = Number(ekipNo) === Number(e.ekip_no);
        return (
          <Pressable key={e.ekip_no} onPress={() => setEkipNo(e.ekip_no)} accessibilityRole="radio" accessibilityState={{ selected: sec }} style={{ flexDirection: "row", alignItems: "center", minHeight: 52, borderTopWidth: 0.5, borderTopColor: renk.cizgi }}>
            <View style={{ flex: 1 }}>
              <Metin tur="govde">{e.ad}{Number(e.ekip_no) === Number(r.ekip_no) ? "  (mevcut)" : ""}</Metin>
              <Metin tur="minik" renk={e.ulasim?.ulasir ? renk.metinIkincil : renk.hata}>{[e.bolge, `${e.uyeler.length} üye`, e.ulasim?.ulasir ? `${e.ulasim.ulasan} hesap` : "mobil hesap yok"].join(" · ")}</Metin>
            </View>
            <Ionicons name={sec ? "radio-button-on" : "radio-button-off"} size={24} color={sec ? renk.lacivert : renk.cizgiKoyu} />
          </Pressable>
        );
      }) : (
        <View>
          <Alan etiket="Ara" deger={q} onDegis={setQ} ipucu="Ad, bölge" buyukHarf="none" />
          {kisiler.filter((p) => !n || `${p.ad} ${p.bolge || ""}`.toLocaleLowerCase("tr-TR").includes(n)).slice(0, 60).map((p) => {
            const sec = secilen.some((x) => x.email === String(p.email).toLowerCase());
            return (
              <Pressable key={p.email} onPress={() => setSecilen(sec ? kisiCikar(secilen, String(p.email).toLowerCase()) : kisiEkle(secilen, { email: String(p.email).toLowerCase(), ad: p.ad }))} accessibilityRole="checkbox" accessibilityState={{ checked: sec }}
                style={{ flexDirection: "row", alignItems: "center", minHeight: 48, borderTopWidth: 0.5, borderTopColor: renk.cizgi }}>
                <Metin tur="govde" style={{ flex: 1 }}>{p.ad}<Metin tur="minik" renk={renk.metinSoluk}>  {p.bolge || ""}</Metin></Metin>
                <Ionicons name={sec ? "checkbox" : "square-outline"} size={22} color={sec ? renk.lacivert : renk.cizgiKoyu} />
              </Pressable>
            );
          })}
        </View>
      )}
      <Alan etiket="Gerekçe" zorunlu deger={gerekce} onDegis={setGerekce} ipucu={basladi ? "Neden devrediliyor?" : "Neden değişiyor?"} style={{ marginTop: aralik.m }} />
      <View style={{ flexDirection: "row", gap: aralik.s }}>
        <Buton baslik="Vazgeç" tur="ikincil" onPress={onVazgec} style={{ flex: 1 }} />
        <Buton baslik={basladi ? "Kalan işi devret" : "Değiştir"} onPress={gonder} yukleniyor={bekle} style={{ flex: 1.4 }} />
      </View>
    </Kart>
  );
}

function IptalPaneli({ r, bekle, onVazgec, onGonder }) {
  const [gerekce, setGerekce] = useState("");
  const basladi = !!r.islemler?.baslamis;
  return (
    <Kart style={{ marginTop: aralik.s }}>
      <Metin tur="baslikM" style={{ fontWeight: "700" }}>Atamayı iptal et</Metin>
      {basladi ? <Bant tonAdi="uyari" metin="Bu işte çalışma başlamış. İptal için açık onay gerekir; ekibin gün kayıtları korunur." style={{ marginVertical: aralik.xs }} /> : <Metin tur="kucuk" renk={renk.metinIkincil} style={{ marginBottom: aralik.xs }}>Atama ekibin aktif listesinden kalkar; kayıt geçmişte kalır.</Metin>}
      <Alan etiket="İptal gerekçesi" zorunlu deger={gerekce} onDegis={setGerekce} ipucu="En az 3 karakter" />
      <View style={{ flexDirection: "row", gap: aralik.s }}>
        <Buton baslik="Vazgeç" tur="ikincil" onPress={onVazgec} style={{ flex: 1 }} />
        <Buton baslik={basladi ? "Onaylıyorum, iptal et" : "İptal et"} tur="tehlike" onPress={() => { if (gerekce.trim().length < 3) return Alert.alert("Gerekçe gerekli", "İptal gerekçesini yazın"); onGonder({ gerekce: gerekce.trim(), baslamis_onay: basladi }); }} yukleniyor={bekle} style={{ flex: 1.4 }} />
      </View>
    </Kart>
  );
}
