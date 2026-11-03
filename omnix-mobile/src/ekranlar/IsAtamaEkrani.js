// İş Atama (yönetici, 03.11.2026): web "Rollout İş Atama" ile AYNI kayıtlar, yetki ve kurallar; telefon için adımlı form.
// Sekmeler: Yeni Atama (kategori → iş kodu → ekip/personel → tarih/saat/not → kontrol) · Atamalar (bugün / gelecek / devam /
// tamamlanan / iptal + arama + bölge / ekip / durum filtreleri). Taslak telefonda saklanır (bağlantı kesilince kaybolmaz);
// kesin kayıt yalnız sunucu onayıyla — çevrimdışıyken "oluşturuldu" denmez. Aynı istek anahtarıyla tekrar → tek kayıt.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { aralik, DOKUNMA, kose, renk, yazi } from "../tema";
import { BilgiSatiri, BolumBasligi, Buton, Kart, Metin, Rozet } from "../bilesenler/temel";
import { Bant, BosDurum, EskiVeriBandi, HataDurum, IskeletKart, Yukleniyor } from "../bilesenler/durum";
import { Alan, CipSecim, TarihAlani } from "../bilesenler/form";
import { Ekran } from "../bilesenler/Ekran";
import { Segment } from "./HarcamalarEkrani";
import { useOturum } from "../oturum/OturumSaglayici";
import { useGecersizKil, useVeri } from "../api/veri";
import { atamaApi } from "../api/uclar";
import { hataMetni } from "../mantik/hata";
import { durumBilgisi } from "../mantik/durumlar";
import { taslak, taslakKaydet, taslakSil, yeniKimlik } from "../taslak/taslakDepo";
import { ADIMLAR, BOS_FORM, LISTE_FILTRELERI, TASLAK_TURU, adimHatalari, adimTamam, ekiptenKisiler, formHatalari, govdeHazirla, isCikar, isEkle, kartAltSatir, kisiCikar, kisiEkle,
  ozetSatirlari, sahasizMi, tarihTR, tekilMi } from "../mantik/atama";

const TASLAK_ID = "is-atama-form"; // kişi + firma kapsamında tek form taslağı
const PIN = { YESIL: "#16A34A", SARI: "#E0A21B", MAVI: "#2563EB", GRI: "#8A97A8" };

export function IsAtamaEkrani({ navigation, route }) {
  const [sekme, setSekme] = useState(route?.params?.sekme || "yeni");
  return (
    <Ekran baslik="İş Atama" altBaslik="Rollout iş ataması · web ile aynı kayıtlar" kaydir={false}>
      <View style={{ paddingHorizontal: aralik.m, paddingTop: aralik.s }}>
        <Segment secenekler={[{ id: "yeni", ad: "Yeni Atama" }, { id: "liste", ad: "Atamalar" }]} deger={sekme} onSec={setSekme} />
      </View>
      {sekme === "yeni" ? <YeniAtama navigation={navigation} onOlustu={() => setSekme("liste")} /> : <Atamalar navigation={navigation} />}
    </Ekran>
  );
}

// ── YENİ ATAMA ─────────────────────────────────────────────────────────────────────────────────────────────────────
function YeniAtama({ navigation, onOlustu }) {
  const { kapsam } = useOturum();
  const gecersizKil = useGecersizKil();
  const b = useVeri("isAtamaBaslangic", () => atamaApi.baslangic(), { odaktaYenile: false });
  const [f, setF] = useState(BOS_FORM);
  const [adim, setAdim] = useState(0);
  const [hazir, setHazir] = useState(false);
  const [kontrol, setKontrol] = useState(null); // sunucu kontrol sonucu (özet adımı)
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [sonuc, setSonuc] = useState(null); // başarılı kayıt
  const anahtar = useRef(null); // istek anahtarı: form taslağıyla birlikte saklanır → tekrar denemede aynı
  const kat = useMemo(() => (b.veri?.kategoriler || []).find((k) => k.kod === f.kategori) || null, [b.veri, f.kategori]);

  // Taslağı yükle (bağlantı kesilince / uygulama kapanınca form kaybolmaz)
  useEffect(() => { let iptal = false; taslak(kapsam, TASLAK_ID).then((t) => { if (iptal) return; if (t?.form) { setF({ ...BOS_FORM, ...t.form }); setAdim(t.adim || 0); anahtar.current = t.anahtar || null; } setHazir(true); }); return () => { iptal = true; }; }, [kapsam]);
  useEffect(() => { if (hazir) taslakKaydet(kapsam, { id: TASLAK_ID, tur: TASLAK_TURU, form: f, adim, anahtar: anahtar.current }).catch(() => {}); }, [f, adim, hazir, kapsam]);
  const guncelle = (p) => setF((x) => ({ ...x, ...p }));
  const sifirla = async () => { setF(BOS_FORM); setAdim(0); setKontrol(null); setSonuc(null); anahtar.current = null; await taslakSil(kapsam, TASLAK_ID).catch(() => {}); };

  const ileri = () => {
    const h = adimHatalari(ADIMLAR[adim].id, f, kat);
    if (h.length) return Alert.alert("Eksik bilgi", h.join("\n"));
    const sonraki = adim + 1;
    setAdim(sonraki);
    if (ADIMLAR[sonraki]?.id === "ozet") kontrolEt();
  };
  const kontrolEt = async () => {
    setKontrol({ yukleniyor: true });
    try { setKontrol(await atamaApi.kontrol(govdeHazirla(f))); }
    catch (e) { setKontrol({ hata: hataMetni(e), agHatasi: !!e?.sonucBelirsiz }); }
  };
  const olustur = async () => {
    const h = formHatalari(f, kat);
    if (h.length) return Alert.alert("Eksik bilgi", h.join("\n"));
    if (kontrol?.engeller?.length) return Alert.alert("Atama oluşturulamaz", kontrol.engeller.join("\n\n"));
    if (gonderiliyor) return;
    if (!anahtar.current) { anahtar.current = `ia-${yeniKimlik()}`; taslakKaydet(kapsam, { id: TASLAK_ID, tur: TASLAK_TURU, form: f, adim, anahtar: anahtar.current }).catch(() => {}); }
    setGonderiliyor(true);
    try {
      const r = await atamaApi.olustur(govdeHazirla(f), anahtar.current);
      gecersizKil(["isAtamaListe", "isler"]);
      await taslakSil(kapsam, TASLAK_ID).catch(() => {});
      setSonuc(r);
    } catch (e) {
      if (e?.sonucBelirsiz) Alert.alert("Bağlantı sorunu", "Atama oluşturulamadı; bağlantı gelince tekrar deneyin. Form telefonda saklandı; aynı istek tekrar gönderilince ikinci kayıt oluşmaz.");
      else if (e?.durumKodu === 409 && e?.govde?.mukerrer) Alert.alert("Açık atama var", `${e.message}\n\nMevcut atamayı Atamalar sekmesinden güncelleyebilirsiniz.`);
      else Alert.alert("Atama oluşturulamadı", hataMetni(e));
    } finally { setGonderiliyor(false); }
  };

  if (b.yukleniyor && !b.veri) return <View style={{ padding: aralik.m }}><IskeletKart /><IskeletKart /></View>;
  if (b.hata && !b.veri) return <View style={{ padding: aralik.m }}><Kart><HataDurum hata={b.hata} onTekrar={b.yenile} /></Kart></View>;
  if (sonuc) return <Basari sonuc={sonuc} onYeni={sifirla} onListe={() => { sifirla(); onOlustu(); }} navigation={navigation} />;
  const A = ADIMLAR[adim].id;
  return (
    <View style={{ flex: 1 }}>
      <AdimCubugu adim={adim} f={f} kat={kat} onSec={(i) => { if (i < adim || ADIMLAR.slice(0, i).every((a) => adimTamam(a.id, f, kat))) { setAdim(i); if (ADIMLAR[i].id === "ozet") kontrolEt(); } }} />
      <ScrollView contentContainerStyle={{ padding: aralik.m, paddingBottom: aralik.xxl }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        {A === "kategori" ? <KategoriAdimi f={f} guncelle={guncelle} kategoriler={b.veri?.kategoriler || []} kat={kat} /> : null}
        {A === "saha" ? <SahaAdimi f={f} guncelle={guncelle} kat={kat} /> : null}
        {A === "kisi" ? <KisiAdimi f={f} guncelle={guncelle} ekipler={b.veri?.ekipler || []} kisiler={b.veri?.kisiler || []} /> : null}
        {A === "zaman" ? <ZamanAdimi f={f} guncelle={guncelle} bugun={b.veri?.bugun} /> : null}
        {A === "ozet" ? <OzetAdimi f={f} kat={kat} ekipler={b.veri?.ekipler || []} kontrol={kontrol} onKontrol={kontrolEt} /> : null}
      </ScrollView>
      <View style={{ flexDirection: "row", gap: aralik.s, padding: aralik.m, paddingTop: aralik.s, backgroundColor: renk.yuzey, borderTopWidth: 0.5, borderTopColor: renk.cizgi }}>
        {adim > 0 ? <Buton baslik="Geri" tur="ikincil" ikon="chevron-back" onPress={() => setAdim(adim - 1)} style={{ flex: 1 }} /> : <Buton baslik="Temizle" tur="metin" onPress={() => Alert.alert("Formu temizle", "Girdiğiniz bilgiler silinecek.", [{ text: "Vazgeç", style: "cancel" }, { text: "Temizle", style: "destructive", onPress: sifirla }])} style={{ flex: 1 }} />}
        {A === "ozet"
          ? <Buton baslik="Atamayı oluştur" ikon="checkmark-circle" tur="basari" onPress={olustur} yukleniyor={gonderiliyor} devreDisi={!!kontrol?.yukleniyor || !!kontrol?.engeller?.length} style={{ flex: 1.6 }} erisimIpucu="Kayıt sunucuda oluşturulur" />
          : <Buton baslik="Devam" ikon="chevron-forward" onPress={ileri} style={{ flex: 1.6 }} />}
      </View>
    </View>
  );
}

function AdimCubugu({ adim, f, kat, onSec }) {
  return (
    <View style={{ flexDirection: "row", paddingHorizontal: aralik.m, paddingVertical: aralik.xs, backgroundColor: renk.yuzey, borderBottomWidth: 0.5, borderBottomColor: renk.cizgi }} accessibilityRole="tablist">
      {ADIMLAR.map((a, i) => {
        const tamam = i < adim && adimTamam(a.id, f, kat);
        const simdi = i === adim;
        return (
          <Pressable key={a.id} onPress={() => onSec(i)} accessibilityRole="tab" accessibilityState={{ selected: simdi }} style={{ flex: 1, alignItems: "center", minHeight: 44, justifyContent: "center" }}>
            <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: tamam ? renk.basari : simdi ? renk.lacivert : renk.cizgi }}>
              {tamam ? <Ionicons name="checkmark" size={15} color="#fff" /> : <Metin tur="minik" renk={simdi ? "#fff" : renk.metinIkincil}>{i + 1}</Metin>}
            </View>
            <Metin tur="minik" renk={simdi ? renk.lacivert : renk.metinSoluk} style={{ marginTop: 2 }}>{a.ad}</Metin>
          </Pressable>
        );
      })}
    </View>
  );
}

function KategoriAdimi({ f, guncelle, kategoriler, kat }) {
  return (
    <View>
      <Metin tur="baslikM" style={{ fontWeight: "700", marginBottom: 4 }}>İş kategorisi</Metin>
      <Metin tur="kucuk" renk={renk.metinIkincil} style={{ marginBottom: aralik.s }}>Kategoriye göre tek / çoklu saha ve zorunlu alanlar web ile aynıdır.</Metin>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: aralik.xs }}>
        {kategoriler.map((k) => {
          const sec = k.kod === f.kategori;
          return (
            <Pressable key={k.kod} onPress={() => guncelle({ kategori: k.kod, alt_tip: "", isler: k.tekil_site && f.isler.length > 1 ? f.isler.slice(0, 1) : f.isler })} accessibilityRole="radio" accessibilityState={{ selected: sec }}
              style={({ pressed }) => [{ minHeight: DOKUNMA, paddingHorizontal: 14, borderRadius: kose.m, borderWidth: 1.5, borderColor: sec ? renk.lacivert : renk.cizgiKoyu, backgroundColor: sec ? renk.lacivert : renk.yuzey, justifyContent: "center" }, pressed && { opacity: 0.8 }]}>
              <Metin tur="kucukKalin" renk={sec ? "#fff" : renk.metin}>{k.ikon ? `${k.ikon} ` : ""}{k.ad}</Metin>
              <Metin tur="minik" renk={sec ? "#C7D3E3" : renk.metinSoluk}>{k.saha_zorunlu === false ? "sahasız olabilir" : k.tekil_site ? "tek saha" : "çoklu saha"}{k.qc_yazar ? " · QC" : ""}</Metin>
            </Pressable>
          );
        })}
      </View>
      {(kat?.alt_tipler || []).length ? (
        <CipSecim etiket={`${kat.ad} tipi`} zorunlu secenekler={kat.alt_tipler.map((t) => ({ id: t, ad: t }))} deger={f.alt_tip} onSec={(t) => guncelle({ alt_tip: t })} style={{ marginTop: aralik.m }} />
      ) : null}
    </View>
  );
}

function SahaAdimi({ f, guncelle, kat }) {
  const [q, setQ] = useState("");
  const [sonuc, setSonuc] = useState(null);
  const [ariyor, setAriyor] = useState(false);
  const zaman = useRef(null);
  const ara = useCallback((metin) => {
    setQ(metin);
    clearTimeout(zaman.current);
    const t = metin.replace(/\s+/g, "");
    if (t.length < 2) { setSonuc(null); return; }
    zaman.current = setTimeout(async () => {
      setAriyor(true);
      try { setSonuc(await atamaApi.ara(t)); } catch (e) { setSonuc({ hata: hataMetni(e) }); } finally { setAriyor(false); }
    }, 350);
  }, []);
  const tekil = tekilMi(kat);
  const sahasiz = sahasizMi(kat);
  return (
    <View>
      <Metin tur="baslikM" style={{ fontWeight: "700", marginBottom: 4 }}>{sahasiz ? "Yer / saha (isteğe bağlı)" : "Saha ve iş kodu"}</Metin>
      <Metin tur="kucuk" renk={renk.metinIkincil} style={{ marginBottom: aralik.s }}>
        {tekil ? `${kat?.ad}: tek iş kodu seçilir.` : "Aynı sahadaki farklı işler ayrı seçilir."} Site ID ya da iş kodunun ilk 2 karakterini yazın.
      </Metin>
      {f.isler.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: aralik.xs, marginBottom: aralik.s }}>
          {f.isler.map((i) => (
            <Pressable key={i.site_code} onPress={() => guncelle({ isler: isCikar(f.isler, i.site_code) })} accessibilityRole="button" accessibilityLabel={`${i.site_code} seçimini kaldır`}
              style={{ flexDirection: "row", alignItems: "center", backgroundColor: renk.lacivert, borderRadius: kose.tam, paddingLeft: 12, paddingRight: 8, minHeight: 36 }}>
              <Metin tur="kucukKalin" renk="#fff">{i.site_code}</Metin>
              <Ionicons name="close-circle" size={18} color="#C7D3E3" style={{ marginLeft: 6 }} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: renk.cizgiKoyu, borderRadius: kose.m, backgroundColor: renk.yuzey, paddingHorizontal: aralik.s }}>
        <Ionicons name="search" size={18} color={renk.metinSoluk} />
        <TextInput value={q} onChangeText={ara} placeholder="Örn. BU12 veya BU1234_NR700" placeholderTextColor={renk.metinSoluk} autoCapitalize="characters" autoCorrect={false} returnKeyType="search"
          accessibilityLabel="Site ID veya iş kodu ara" style={[yazi.govde, { flex: 1, color: renk.metin, paddingVertical: 12, paddingHorizontal: aralik.xs }]} />
        {ariyor ? <Yukleniyor metin="" style={{ paddingVertical: 0 }} /> : null}
      </View>
      {sonuc?.hata ? <Metin tur="kucuk" renk={renk.hata} style={{ marginTop: aralik.xs }}>{sonuc.hata}</Metin> : null}
      {sonuc && !sonuc.hata && !sonuc.sahalar?.length ? <Metin tur="kucuk" renk={renk.metinIkincil} style={{ marginTop: aralik.xs }}>Kapsamınızda eşleşen iş kodu yok.</Metin> : null}
      {(sonuc?.sahalar || []).map((s) => (
        <Kart key={s.fiziksel_id} style={{ marginTop: aralik.s, paddingVertical: aralik.xs }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
            <Metin tur="govdeKalin" style={{ flex: 1 }}>{s.fiziksel_id}</Metin>
            <Metin tur="minik" renk={renk.metinIkincil}>{[s.il, s.bolge && s.bolge !== s.il ? `${s.bolge} bölgesi` : null].filter(Boolean).join(" · ")}</Metin>
          </View>
          {s.isler.map((i) => {
            const sec = f.isler.some((x) => x.site_code === i.site_code);
            const acik = (i.acik_atamalar || []).filter((a) => a.kategori === f.kategori);
            return (
              <Pressable key={i.site_code} onPress={() => guncelle({ isler: sec ? isCikar(f.isler, i.site_code) : isEkle(f.isler, { site_code: i.site_code, site_type: i.site_type }, tekil) })}
                accessibilityRole="checkbox" accessibilityState={{ checked: sec }}
                style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", minHeight: 52, borderTopWidth: 0.5, borderTopColor: renk.cizgi }, pressed && { opacity: 0.7 }]}>
                <View style={{ width: 4, alignSelf: "stretch", borderRadius: 2, backgroundColor: PIN[i.fiili?.renk] || renk.cizgiKoyu, marginRight: aralik.s, marginVertical: 8 }} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Metin tur="govdeKalin" numberOfLines={1}>{i.site_code}{i.site_type ? <Metin tur="kucuk" renk={renk.metinSoluk}>  {i.site_type}</Metin> : null}</Metin>
                  <Metin tur="minik" renk={renk.metinIkincil} numberOfLines={2}>
                    {[i.durum_ad, i.atanan_ekip ? `ekip: ${i.atanan_ekip}` : null, (i.taseronlar || []).join(", "), i.fiili?.issue ? "⚠ issue" : null].filter(Boolean).join(" · ") || "—"}
                  </Metin>
                  {(i.acik_atamalar || []).length ? <Metin tur="minik" renk={acik.length ? renk.hata : renk.uyari}>{i.acik_atamalar.map((a) => `#${a.id} ${a.kategori_ad || a.kategori} · ${a.kisiler.join(", ") || "taşeron"}${a.plan_tarihi ? ` · ${tarihTR(a.plan_tarihi)}` : ""}`).join("\n")}</Metin> : null}
                </View>
                <Ionicons name={sec ? "checkbox" : "square-outline"} size={24} color={sec ? renk.lacivert : renk.cizgiKoyu} />
              </Pressable>
            );
          })}
        </Kart>
      ))}
      {sonuc?.kalan_saha ? <Metin tur="minik" renk={renk.metinSoluk} style={{ marginTop: aralik.xs }}>+{sonuc.kalan_saha} saha daha — aramayı daraltın</Metin> : null}
      {sahasiz ? <Alan etiket="Yer / açıklama" zorunlu={!f.isler.length} deger={f.konum_aciklama} onDegis={(t) => guncelle({ konum_aciklama: t })} ipucu="Örn. Bursa depo, araç bakımı" style={{ marginTop: aralik.m }} /> : null}
    </View>
  );
}

function KisiAdimi({ f, guncelle, ekipler, kisiler }) {
  const [mod, setMod] = useState(f.ekip_no != null ? "ekip" : f.personeller.length ? "kisi" : "ekip");
  const [q, setQ] = useState("");
  const ekipSec = (e) => guncelle({ ekip_no: e.ekip_no, personeller: ekiptenKisiler(e) });
  const kisiToggle = (p) => guncelle({ ekip_no: null, personeller: f.personeller.some((x) => x.email === p.email) ? kisiCikar(f.personeller, p.email) : kisiEkle(f.personeller, { email: String(p.email).toLowerCase(), ad: p.ad, ulasir: true }) });
  const n = q.trim().toLocaleLowerCase("tr-TR");
  const suzKisi = kisiler.filter((p) => !n || `${p.ad} ${p.bolge || ""} ${p.unvan || ""}`.toLocaleLowerCase("tr-TR").includes(n));
  return (
    <View>
      <Metin tur="baslikM" style={{ fontWeight: "700", marginBottom: 4 }}>Ekip / personel</Metin>
      <Metin tur="kucuk" renk={renk.metinIkincil} style={{ marginBottom: aralik.s }}>Ekip seçince kayıtlı üyeler topluca atanır; mobil hesabı olmayan üye açıkça gösterilir.</Metin>
      <Segment secenekler={[{ id: "ekip", ad: "Ekip seç" }, { id: "kisi", ad: "Tek tek personel" }]} deger={mod} onSec={setMod} />
      {mod === "ekip" ? (
        ekipler.length ? ekipler.map((e) => {
          const sec = Number(f.ekip_no) === Number(e.ekip_no);
          return (
            <Kart key={e.ekip_no} onPress={() => ekipSec(e)} erisimEtiketi={`${e.ad}, ${e.ulasim?.mesaj || ""}`} style={{ marginBottom: aralik.s, borderWidth: 1.5, borderColor: sec ? renk.lacivert : "transparent" }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Metin tur="govdeKalin">{e.ad}{e.plaka ? <Metin tur="kucuk" renk={renk.metinSoluk}>  {e.plaka}</Metin> : null}</Metin>
                  <Metin tur="kucuk" renk={renk.metinIkincil}>{[e.bolge, e.tip === "INHOUSE" ? "kendi ekibimiz" : e.tip === "TASERON" ? `taşeron${e.firma_adi ? ` · ${e.firma_adi}` : ""}` : null, e.sef ? `şef: ${e.sef.ad}` : null].filter(Boolean).join(" · ")}</Metin>
                </View>
                <Ionicons name={sec ? "radio-button-on" : "radio-button-off"} size={24} color={sec ? renk.lacivert : renk.cizgiKoyu} />
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: aralik.xs }}>
                {e.uyeler.map((u) => (
                  <View key={u.ad + (u.email || "")} style={{ flexDirection: "row", alignItems: "center", borderRadius: kose.tam, paddingHorizontal: 10, minHeight: 30, backgroundColor: u.ulasir ? renk.basariZemin : renk.hataZemin }}>
                    <Ionicons name={u.ulasir ? "phone-portrait-outline" : "alert-circle-outline"} size={13} color={u.ulasir ? renk.basari : renk.hata} />
                    <Metin tur="minik" renk={u.ulasir ? renk.basari : renk.hata} style={{ marginLeft: 4 }}>{u.ad}{u.ulasir ? "" : " · hesap yok"}</Metin>
                  </View>
                ))}
                {!e.uyeler.length ? <Metin tur="minik" renk={renk.hata}>Ekipte kayıtlı üye yok — atama kimseye ulaşmaz</Metin> : null}
              </View>
            </Kart>
          );
        }) : <Kart><BosDurum ikon="people-outline" baslik="Kapsamınızda ekip yok" aciklama="Teknocenter ekipleri Organizasyon şemasında tanımlanır." /></Kart>
      ) : (
        <View>
          {f.personeller.length ? <Metin tur="kucuk" renk={renk.lacivert} style={{ marginBottom: aralik.xs }}>{f.personeller.length} kişi seçildi: {f.personeller.map((p) => p.ad).join(", ")}</Metin> : null}
          <Alan etiket="Ara" deger={q} onDegis={setQ} ipucu="Ad, bölge, ünvan" buyukHarf="none" />
          <Kart style={{ paddingVertical: 0 }}>
            {suzKisi.slice(0, 80).map((p, i) => {
              const sec = f.personeller.some((x) => x.email === String(p.email).toLowerCase());
              return (
                <Pressable key={p.email} onPress={() => kisiToggle(p)} accessibilityRole="checkbox" accessibilityState={{ checked: sec }}
                  style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", minHeight: 52, borderTopWidth: i ? 0.5 : 0, borderTopColor: renk.cizgi }, pressed && { opacity: 0.7 }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Metin tur="govde" numberOfLines={1}>{p.ad}</Metin>
                    <Metin tur="minik" renk={renk.metinIkincil} numberOfLines={1}>{[p.unvan, p.bolge, p.ekip ? `ekip ${p.ekip}` : null].filter(Boolean).join(" · ")}</Metin>
                  </View>
                  <Ionicons name={sec ? "checkbox" : "square-outline"} size={24} color={sec ? renk.lacivert : renk.cizgiKoyu} />
                </Pressable>
              );
            })}
            {!suzKisi.length ? <Metin tur="kucuk" renk={renk.metinIkincil} style={{ paddingVertical: aralik.s }}>Eşleşen personel yok</Metin> : null}
          </Kart>
        </View>
      )}
    </View>
  );
}

function ZamanAdimi({ f, guncelle, bugun }) {
  const enGec = new Date(); enGec.setFullYear(enGec.getFullYear() + 1);
  return (
    <View>
      <Metin tur="baslikM" style={{ fontWeight: "700", marginBottom: 4 }}>Tarih, saat ve not</Metin>
      <Metin tur="kucuk" renk={renk.metinIkincil} style={{ marginBottom: aralik.s }}>Saat girilmezse görev Weekly Plan'da gün bazlı görünür; saat uydurulmaz.</Metin>
      <TarihAlani etiket="Planlanan tarih" zorunlu deger={f.plan_tarihi} onDegis={(g) => guncelle({ plan_tarihi: g })} enGec={enGec} />
      {bugun ? <View style={{ flexDirection: "row", gap: aralik.xs, marginTop: -aralik.xs, marginBottom: aralik.m }}>
        {[["Bugün", bugun], ["Yarın", gunEkle(bugun, 1)], ["+2 gün", gunEkle(bugun, 2)]].map(([ad, g]) => (
          <Pressable key={ad} onPress={() => guncelle({ plan_tarihi: g })} accessibilityRole="button" style={{ borderRadius: kose.tam, borderWidth: 1, borderColor: f.plan_tarihi === g ? renk.lacivert : renk.cizgiKoyu, backgroundColor: f.plan_tarihi === g ? renk.lacivert : renk.yuzey, paddingHorizontal: 12, minHeight: 34, justifyContent: "center" }}>
            <Metin tur="minik" renk={f.plan_tarihi === g ? "#fff" : renk.metin}>{ad}</Metin>
          </Pressable>
        ))}
      </View> : null}
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: aralik.s }}>
        <Metin tur="govde" style={{ flex: 1 }}>Saat belirle</Metin>
        <Switch value={!!f.saatli} onValueChange={(v) => guncelle({ saatli: v })} trackColor={{ true: renk.lacivert }} accessibilityLabel="Saat belirle" />
      </View>
      {f.saatli ? (
        <View style={{ flexDirection: "row", gap: aralik.s }}>
          <Alan etiket="Başlangıç" deger={f.bas_saat} onDegis={(t) => guncelle({ bas_saat: saatDuzelt(t) })} ipucu="08:30" klavye="numbers-and-punctuation" style={{ flex: 1 }} />
          <Alan etiket="Bitiş" deger={f.bit_saat} onDegis={(t) => guncelle({ bit_saat: saatDuzelt(t) })} ipucu="17:30" klavye="numbers-and-punctuation" style={{ flex: 1 }} />
        </View>
      ) : null}
      <Alan etiket="Atayan notu" cokSatir deger={f.atayan_not} onDegis={(t) => guncelle({ atayan_not: t })} ipucu="Ekibin İşlerim detayında görünür (anahtar, irtibat, dikkat edilecekler)" />
    </View>
  );
}
const saatDuzelt = (t) => { const d = String(t || "").replace(/[^\d]/g, "").slice(0, 4); return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d; };
const gunEkle = (g, n) => { const d = new Date(`${g}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function OzetAdimi({ f, kat, ekipler, kontrol, onKontrol }) {
  const satirlar = ozetSatirlari(f, kat, ekipler);
  return (
    <View>
      <Metin tur="baslikM" style={{ fontWeight: "700", marginBottom: aralik.s }}>Kontrol ve onay</Metin>
      <Kart style={{ paddingVertical: aralik.xs }}>
        {satirlar.map((s, i) => <BilgiSatiri key={s.etiket + i} etiket={s.etiket} deger={s.deger} son={i === satirlar.length - 1} />)}
      </Kart>
      {kontrol?.yukleniyor ? <Yukleniyor metin="Sunucuda çakışma ve kapsam kontrolü…" style={{ marginTop: aralik.s }} /> : null}
      {kontrol?.hata ? <Bant tonAdi={kontrol.agHatasi ? "uyari" : "hata"} baslik={kontrol.agHatasi ? "Kontrol yapılamadı" : "Kontrol hatası"} metin={kontrol.agHatasi ? "Bağlantı yok. Kesin atama için bağlantı gerekir; form telefonda saklı." : kontrol.hata} eylem="Tekrar dene" onEylem={onKontrol} style={{ marginTop: aralik.s }} /> : null}
      {kontrol && !kontrol.yukleniyor && !kontrol.hata ? (
        <View style={{ marginTop: aralik.s }}>
          {kontrol.engeller?.map((e, i) => <Bant key={i} tonAdi="hata" ikon="close-circle" baslik="Atama oluşturulamaz" metin={e} style={{ marginBottom: aralik.xs }} />)}
          {kontrol.uyarilar?.map((u, i) => <Bant key={i} tonAdi="uyari" metin={u} style={{ marginBottom: aralik.xs }} />)}
          {!kontrol.engeller?.length && !kontrol.uyarilar?.length ? <Bant tonAdi="basari" ikon="checkmark-circle" metin="Çakışma yok; seçilen herkesin mobil hesabı var." /> : null}
        </View>
      ) : null}
    </View>
  );
}

function Basari({ sonuc, onYeni, onListe, navigation }) {
  const r = sonuc?.row || {};
  const u = sonuc?.ulasim;
  return (
    <ScrollView contentContainerStyle={{ padding: aralik.m }}>
      <Kart>
        <View style={{ alignItems: "center", paddingVertical: aralik.s }}>
          <Ionicons name="checkmark-circle" size={56} color={renk.basari} />
          <Metin tur="baslikL" style={{ marginTop: aralik.xs }}>{sonuc?.tekrar ? "Atama zaten oluşturulmuştu" : "Atama oluşturuldu"}</Metin>
          <Metin tur="kucuk" renk={renk.metinIkincil}>Atama no #{r.id}{sonuc?.tekrar ? " · ikinci kayıt açılmadı" : ""}</Metin>
        </View>
        <BilgiSatiri etiket="Kategori" deger={r.kategori_ad || r.kategori} />
        <BilgiSatiri etiket="İş kodları" deger={(r.site_codes || []).join(", ") || r.konum_aciklama || "—"} />
        <BilgiSatiri etiket="Plan" deger={r.plan_tarihi ? tarihTR(String(r.plan_tarihi).slice(0, 10)) : "—"} son />
      </Kart>
      {u ? (
        <Kart style={{ marginTop: aralik.s }}>
          <Metin tur="etiket" renk={renk.metinSoluk} style={{ marginBottom: 6 }}>İŞLERİM EKRANINA YANSIYANLAR</Metin>
          {u.ulasan.map((p) => <View key={p.email} style={{ flexDirection: "row", alignItems: "center", minHeight: 32 }}><Ionicons name="phone-portrait" size={16} color={renk.basari} /><Metin tur="govde" style={{ marginLeft: 8 }}>{p.ad}</Metin></View>)}
          {u.eksik.map((p) => <View key={p.ad} style={{ flexDirection: "row", alignItems: "center", minHeight: 32 }}><Ionicons name="alert-circle" size={16} color={renk.hata} /><Metin tur="govde" renk={renk.hata} style={{ marginLeft: 8, flex: 1 }}>{p.ad} — {p.neden}</Metin></View>)}
          {!u.ulasan.length ? <Bant tonAdi="hata" metin="Atama kimseye ulaşmıyor: seçilen kişilerin mobil hesabı yok. Kayıt web listesinde görünür." style={{ marginTop: aralik.xs }} /> : null}
        </Kart>
      ) : null}
      <View style={{ flexDirection: "row", gap: aralik.s, marginTop: aralik.m }}>
        <Buton baslik="Yeni atama" tur="ikincil" ikon="add" onPress={onYeni} style={{ flex: 1 }} />
        <Buton baslik="Atamayı aç" ikon="open-outline" onPress={() => { onListe(); navigation.navigate("IsAtamaDetay", { id: r.id }); }} style={{ flex: 1 }} />
      </View>
    </ScrollView>
  );
}

// ── ATAMALAR ───────────────────────────────────────────────────────────────────────────────────────────────────────
function Atamalar({ navigation }) {
  const [filtre, setFiltre] = useState("bugun");
  const [q, setQ] = useState("");
  const [bolge, setBolge] = useState("");
  const [ekipNo, setEkipNo] = useState("");
  const [durum, setDurum] = useState("");
  const [filtreAcik, setFiltreAcik] = useState(false);
  const anahtar = `isAtamaListe:${filtre}:${bolge}:${ekipNo}:${durum}`;
  const v = useVeri(anahtar, () => atamaApi.liste({ filtre, bolge, ekip_no: ekipNo, durum }));
  // Uygulama öne gelince / ekran açılınca güncel liste (useVeri odakta yeniler); 45 sn'de bir de tazele (ekip başladı / bitirdi / issue)
  useFocusEffect(useCallback(() => { const t = setInterval(() => v.yenile(), 45000); return () => clearInterval(t); }, [v.yenile]));
  const n = q.replace(/\s+/g, "").toLocaleUpperCase("tr-TR");
  const rows = (v.veri?.rows || []).filter((r) => !n || r.site_codes.some((s) => s.replace(/\s+/g, "").toUpperCase().includes(n)) || String(r.konum_aciklama || "").toLocaleUpperCase("tr-TR").includes(n) || (r.ekip_ad || "").toLocaleUpperCase("tr-TR").includes(n));
  const sec = v.veri?.secenekler || { bolgeler: [], ekipler: [], durumlar: [] };
  const aktifFiltre = [bolge, ekipNo, durum].filter(Boolean).length;
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: aralik.m }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: aralik.xs, paddingBottom: aralik.xs }}>
          {LISTE_FILTRELERI.map((x) => (
            <Pressable key={x.id} onPress={() => setFiltre(x.id)} accessibilityRole="tab" accessibilityState={{ selected: filtre === x.id }}
              style={{ borderRadius: kose.tam, minHeight: 36, paddingHorizontal: 14, justifyContent: "center", backgroundColor: filtre === x.id ? renk.lacivert : "#E4E9F0" }}>
              <Metin tur="kucukKalin" renk={filtre === x.id ? "#fff" : renk.metinIkincil}>{x.ad}</Metin>
            </Pressable>
          ))}
          <Pressable onPress={() => setFiltreAcik(!filtreAcik)} accessibilityRole="button" accessibilityLabel="Filtreler" style={{ borderRadius: kose.tam, minHeight: 36, paddingHorizontal: 12, justifyContent: "center", flexDirection: "row", alignItems: "center", backgroundColor: aktifFiltre ? renk.altin : "#E4E9F0" }}>
            <Ionicons name="options-outline" size={16} color={aktifFiltre ? renk.lacivertKoyu : renk.metinIkincil} /><Metin tur="kucukKalin" renk={aktifFiltre ? renk.lacivertKoyu : renk.metinIkincil} style={{ marginLeft: 4 }}>Filtre{aktifFiltre ? ` · ${aktifFiltre}` : ""}</Metin>
          </Pressable>
        </ScrollView>
        <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: renk.cizgiKoyu, borderRadius: kose.m, backgroundColor: renk.yuzey, paddingHorizontal: aralik.s, marginBottom: aralik.xs }}>
          <Ionicons name="search" size={18} color={renk.metinSoluk} />
          <TextInput value={q} onChangeText={setQ} placeholder="Site ID, iş kodu veya ekip" placeholderTextColor={renk.metinSoluk} autoCapitalize="characters" autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Atama ara"
            style={[yazi.govde, { flex: 1, color: renk.metin, paddingVertical: 10, paddingHorizontal: aralik.xs }]} />
        </View>
        {filtreAcik ? (
          <Kart style={{ marginBottom: aralik.xs, paddingVertical: aralik.xs }}>
            <CipSecim etiket="Bölge" secenekler={[{ id: "", ad: "Tümü" }, ...sec.bolgeler.map((b) => ({ id: b, ad: b }))]} deger={bolge} onSec={setBolge} />
            <CipSecim etiket="Ekip" secenekler={[{ id: "", ad: "Tümü" }, ...sec.ekipler.map((e) => ({ id: String(e.ekip_no), ad: e.ad }))]} deger={ekipNo} onSec={setEkipNo} />
            <CipSecim etiket="Durum" secenekler={[{ id: "", ad: "Tümü" }, ...sec.durumlar.map((d) => ({ id: d, ad: durumBilgisi("is", d).ad }))]} deger={durum} onSec={setDurum} />
          </Kart>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={{ padding: aralik.m, paddingTop: 0, paddingBottom: aralik.xxl }} keyboardShouldPersistTaps="handled">
        <EskiVeriBandi v={v} style={{ marginBottom: aralik.s }} />
        {v.yukleniyor && !v.veri ? <><IskeletKart /><IskeletKart /></> : null}
        {v.hata && !v.veri ? <Kart><HataDurum hata={v.hata} onTekrar={v.yenile} /></Kart> : null}
        {v.veri && !rows.length ? <Kart><BosDurum ikon="clipboard-outline" baslik="Bu filtrede atama yok" aciklama={filtre === "bugun" ? "Bugün ve gecikmiş açık atamalar burada listelenir." : null} /></Kart> : null}
        {rows.map((r) => <AtamaKarti key={r.id} r={r} onPress={() => navigation.navigate("IsAtamaDetay", { id: r.id })} />)}
        {v.veri ? <Metin tur="minik" renk={renk.metinSoluk} style={{ textAlign: "center", marginTop: aralik.s }}>{rows.length} atama{v.veri.rows.length >= 500 ? " · ilk 500" : ""}</Metin> : null}
      </ScrollView>
    </View>
  );
}

export function AtamaKarti({ r, onPress }) {
  const d = durumBilgisi("is", r.durum);
  return (
    <Kart onPress={onPress} style={{ marginBottom: aralik.s }} erisimEtiketi={`${r.site_codes.join(", ") || r.konum_aciklama || r.kategori_ad}, ${r.kategori_ad}, ${d.ad}`}>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ width: 4, alignSelf: "stretch", borderRadius: 2, backgroundColor: PIN[r.fiili?.renk] || renk.cizgiKoyu, marginRight: aralik.s }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Metin tur="govdeKalin" numberOfLines={2}>{r.site_codes.join(", ") || r.konum_aciklama || r.kategori_ad}</Metin>
          <Metin tur="kucuk" renk={renk.metinIkincil} numberOfLines={1}>{[r.kategori_ad, r.alt_tip].filter(Boolean).join(" · ")}</Metin>
          <Metin tur="minik" renk={r.geciken ? renk.hata : renk.metinSoluk} numberOfLines={1} style={{ marginTop: 2 }}>{kartAltSatir(r)}</Metin>
          {r.fiili ? <Metin tur="minik" renk={renk.metinIkincil} numberOfLines={1}>Fiilî: {r.fiili.ad}{r.fiili.issue ? " · ⚠ issue" : ""}</Metin> : null}
        </View>
        <View style={{ alignItems: "flex-end", marginLeft: aralik.xs }}>
          <Rozet metin={d.ad} tonAdi={d.ton} />
          {r.saatli ? <Metin tur="minik" renk={renk.metinSoluk} style={{ marginTop: 4 }}>saatli</Metin> : null}
          {r.iptal_nedeni && r.iptal_nedeni !== "IPTAL" ? <Metin tur="minik" renk={renk.metinSoluk} style={{ marginTop: 4 }}>{r.iptal_nedeni === "KALAN_DEVIR" ? "kalan iş devri" : "devir"}</Metin> : null}
        </View>
      </View>
    </Kart>
  );
}
