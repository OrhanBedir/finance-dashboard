// Onaylar: kullanıcının ŞU AN işlem yapabileceği kayıtlar — iş avansı, masraf formu, malzeme talebi, Clean Up — ayrı
// kategorilerde. Liste ve her adımın yetkisi backend'de (/onay/bekleyen: eski onay listeleri + firma bazlı tarihli onay
// devri). Sekme kalıcıdır: bekleyen yokken anlaşılır boş durum gösterilir. Kurgu eski mobil/web ile aynı: avans onayında
// gider hangi firmanın kasasından çıkacak sorulur; masraf formunda Onayla / Geri gönder / Reddet mevcut adım kurallarıyla.
import React, { useRef, useState } from "react";
import { Alert, Image, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { aralik, kose, renk, yazi } from "../tema";
import { BilgiSatiri, BolumBasligi, Buton, Kart, Metin, Rozet } from "../bilesenler/temel";
import { Bant, BosDurum, EskiVeriBandi, HataDurum, IskeletKart } from "../bilesenler/durum";
import { Alan } from "../bilesenler/form";
import { AkisAdimlari } from "../bilesenler/AkisAdimlari";
import { Ekran } from "../bilesenler/Ekran";
import { useOturum } from "../oturum/OturumSaglayici";
import { useGecersizKil, useVeri } from "../api/veri";
import { avansApi, cleanupApi, malzemeApi, onayApi } from "../api/uclar";
import { donem as donemAdi, tarih, tarihUzun, tl } from "../mantik/bicim";
import { durumBilgisi } from "../mantik/durumlar";
import { hataMetni } from "../mantik/hata";
import { ilerleme } from "../mantik/cleanup";

// Onayda sorulan kasa seçenekleri (16.09 / 14.10.2026 kararı; backend kodları ERC / TEKNO)
const KASA = [{ kod: "ERC", ad: "Şimşek" }, { kod: "TEKNO", ad: "Teknocenter" }];
const ADIM_AD = { RM: "Rollout müdürü onayı", PM: "Proje müdürü onayı", PD: "Direktör onayı", ROLLOUT: "Rollout müdürü onayı", MUHASEBE: "Muhasebe kontrolü", DIREKTOR: "Direktör onayı" };
const FIRMA_AD = { ERC: "Şimşek", TEKNO: "Teknocenter", AHY: "AHY" };
// Onay sonrası birlikte yenilenen veriler: liste, rozet, ana sayfa sayacı ve şirket özeti
const YENILE = ["onayBekleyen", "pano", "yonetimOzet", "cleanupOnay"];

// Tek işlem kilidi: çift dokunma / tekrar istek ikinci onay üretmez; sonuç belirsizse liste yenilenir
function useOnayIslemi() {
  const gecersizKil = useGecersizKil();
  const [isleniyor, setIsleniyor] = useState(null);
  const kilit = useRef(false);
  const calistir = async (anahtar, is, mesaj, sonra) => {
    if (kilit.current) return false;
    kilit.current = true;
    setIsleniyor(anahtar);
    try {
      await is();
      gecersizKil(YENILE);
      if (mesaj) Alert.alert(mesaj);
      if (sonra) sonra();
      return true;
    } catch (e) {
      gecersizKil(YENILE); // işlenen kayıt listeden düşer; 409 (az önce işlendi) da burada görünür
      Alert.alert("İşlem tamamlanamadı", e?.sonucBelirsiz ? "Bağlantı koptu. Liste yenilendi; kayıt hâlâ listedeyse tekrar deneyin." : hataMetni(e));
      return false;
    } finally { kilit.current = false; setIsleniyor(null); }
  };
  return { calistir, isleniyor };
}

export function OnaylarEkrani({ navigation }) {
  const { kullanici } = useOturum();
  const onay = useVeri("onayBekleyen", () => onayApi.bekleyen());
  // Clean Up: yalnız bu kullanıcının bölgesindeki (backend süzer) onaya gönderilmiş sahalar
  const cu = useVeri("cleanupOnay", () => cleanupApi.onayBekleyen());
  const { calistir, isleniyor } = useOnayIslemi();
  const [incele, setIncele] = useState(null);
  const [gerekce, setGerekce] = useState(null); // { tur: avans|masraf|malzeme, islem: red|iade, kayit, metin }
  const v = onay.veri;
  const kat = v?.kategoriler || {};
  const avanslar = kat.avans?.rows || [];
  const masraflar = kat.masraf?.rows || [];
  const malzemeler = kat.malzeme?.rows || [];
  const cleanuplar = cu.veri?.rows || [];
  const hicYetkiYok = v && !kat.avans?.yetkili && !kat.masraf?.yetkili && !kat.malzeme?.yetkili && !cu.veri?.yetkili;

  const avansOnayla = (a) => {
    setIncele(null);
    Alert.alert("Avansı onayla — hangi kasa?", `${a.talep_eden_ad || "Personel"} · ${tl(a.tutar)}\n${[a.proje, a.gider_turu].filter(Boolean).join(" · ")}\n\nBu gider hangi firmanın kasasından çıkacak?`, [
      { text: "Vazgeç", style: "cancel" },
      ...KASA.map((k) => ({ text: k.ad, onPress: () => calistir(`a${a.id}`, () => onayApi.avansOnayla(a, k.kod), "Onaylandı") })),
    ]);
  };
  const masrafOnayla = (m) => Alert.alert("Masraf formunu onayla", `${m.personel_ad || m.talep_eden_ad || "Personel"} · ${tl(m.tutar)}\n${m.kalem} kalem, ${m.belge} belge · ${ADIM_AD[m.adim] || m.adim}`, [
    { text: "Vazgeç", style: "cancel" },
    { text: "Onayla", onPress: () => calistir(`m${m.id}`, () => onayApi.masrafOnayla(m.id, m.adim, "Omnix mobil üzerinden onaylandı."), "Onaylandı") },
  ]);
  const malzemeOnayla = (m) => Alert.alert("Malzeme talebini onayla", `${m.talep_no} · ${m.talep_eden_ad || ""}\n${m.kalem_sayisi} kalem`, [
    { text: "Vazgeç", style: "cancel" },
    { text: "Onayla", onPress: () => calistir(`z${m.id}`, () => malzemeApi.durum(m.id, { durum: "FIYAT_GIRISI", onay_notu: "Omnix mobil üzerinden onaylandı." }), "Onaylandı") },
  ]);
  const gerekceGonder = () => {
    const g = gerekce;
    if (!g.metin.trim()) { Alert.alert("Gerekçe gerekli", g.islem === "iade" ? "Personelin neyi düzelteceğini kısaca yazın." : "Reddetme nedenini kısaca yazın."); return; }
    setGerekce(null);
    const metin = g.metin.trim(), k = g.kayit;
    if (g.tur === "avans") calistir(`a${k.id}`, () => avansApi.reddet(k.id, metin, kullanici.email), "Reddedildi");
    else if (g.tur === "malzeme") calistir(`z${k.id}`, () => malzemeApi.durum(k.id, { durum: "REDDEDILDI", notlar: metin }), "Reddedildi");
    else if (g.islem === "iade") calistir(`m${k.id}`, () => onayApi.masrafGeriGonder(k.id, metin, kullanici.email), "Personele geri gönderildi");
    else calistir(`m${k.id}`, () => onayApi.masrafReddet(k.id, k.adim, metin, kullanici.email), "Reddedildi");
  };

  return (
    <Ekran baslik="Onaylar" altBaslik={v ? `${v.sayac + cleanuplar.length} kayıt işleminizi bekliyor` : undefined} geri={false}
      yenileniyor={onay.yenileniyor || cu.yenileniyor} onYenile={() => { onay.yenile(); cu.yenile(); }}>
      {onay.yukleniyor && !v ? <><IskeletKart /><IskeletKart /></> : null}
      {onay.hata && !v ? <Kart><HataDurum hata={onay.hata} baslik="Onay listesi alınamadı" onTekrar={onay.yenile} /></Kart> : null}
      {v ? (
        <>
          <EskiVeriBandi v={onay} style={{ marginBottom: aralik.s }} />
          {(v.yapilandirma_hatasi || []).map((h) => <Bant key={h} tonAdi="uyari" ikon="warning-outline" baslik="Onay devri yapılandırma hatası" metin={h} style={{ marginBottom: aralik.s }} />)}
          {(v.planli || []).filter((p) => !(v.devirler || []).some((d) => d.firma === p.firma && d.adim === p.adim)).map((p) => (
            <Bant key={`${p.firma}-${p.adim}`} tonAdi="bilgi" ikon="calendar-outline" baslik={`${FIRMA_AD[p.firma] || p.firma} · ${p.adim_ad}`}
              metin={`Bu onay yetkiniz ${tarihUzun(p.baslangic)} itibarıyla başlıyor. O tarihten sonra bekleyen talepler (daha önce açılmış olanlar dahil) burada listelenir.`} style={{ marginBottom: aralik.s }} />
          ))}
          {(v.devirler || []).map((d) => (
            <Bant key={`${d.firma}-${d.adim}-a`} tonAdi="notr" ikon="shield-checkmark-outline" metin={`${FIRMA_AD[d.firma] || d.firma} · ${d.adim_ad}: ${tarih(d.baslangic)} tarihinden beri sizde.`} style={{ marginBottom: aralik.s }} />
          ))}
          {hicYetkiYok ? <Kart><BosDurum ikon="checkmark-done-outline" baslik="Onay yetkiniz bulunmuyor" aciklama="Bir onay adımı size atandığında kayıtlar burada görünür." /></Kart> : null}

          {kat.avans?.yetkili ? (
            <>
              <BolumBasligi baslik={`İş avansı talepleri (${avanslar.length})`} style={{ marginTop: 0 }} />
              {avanslar.length === 0 ? <Kart><BosDurum ikon="cash-outline" baslik="Onayınızı bekleyen iş avansı yok" /></Kart> : avanslar.map((a) => (
                <Kart key={a.id} style={{ marginBottom: aralik.s }}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                    <View style={{ flex: 1 }}>
                      <Metin tur="govdeKalin">{a.personel_ad || a.talep_eden_ad || "Personel"}</Metin>
                      <Metin tur="kucuk" renk={renk.metinIkincil} numberOfLines={1}>{[a.gider_turu, a.proje, a.bolge].filter(Boolean).join(" · ")}</Metin>
                      <Metin tur="minik" renk={renk.metinSoluk}>{tarih(a.tarih || a.created_at)} · {ADIM_AD[a.adim] || a.adim}{a.personel_ad && a.talep_eden_ad && a.personel_ad !== a.talep_eden_ad ? ` · Talep eden: ${a.talep_eden_ad}` : ""}</Metin>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Metin tur="baslikM" style={[yazi.tutar, { fontWeight: "700" }]}>{tl(a.tutar)}</Metin>
                      {a.talep_firma && a.talep_firma !== "ERC" ? <Rozet metin={FIRMA_AD[a.talep_firma] || a.talep_firma} tonAdi="notr" style={{ marginTop: 4 }} /> : null}
                    </View>
                  </View>
                  <AkisAdimlari tur="avans" durum={a.durum} kompakt />
                  <View style={{ flexDirection: "row", gap: aralik.xs, marginTop: aralik.s }}>
                    <Buton baslik="İncele" tur="ikincil" kucuk onPress={() => setIncele(a)} style={{ flex: 1 }} />
                    <Buton baslik="Reddet" tur="tehlike" kucuk onPress={() => setGerekce({ tur: "avans", islem: "red", kayit: a, metin: "" })} devreDisi={!!isleniyor} style={{ flex: 1 }} />
                    <Buton baslik="Onayla" tur="basari" kucuk onPress={() => avansOnayla(a)} yukleniyor={isleniyor === `a${a.id}`} devreDisi={!!isleniyor} style={{ flex: 1.2 }} />
                  </View>
                </Kart>
              ))}
            </>
          ) : null}

          {kat.masraf?.yetkili ? (
            <>
              <BolumBasligi baslik={`Masraf formları (${masraflar.length})`} style={kat.avans?.yetkili ? undefined : { marginTop: 0 }} />
              {masraflar.length === 0 ? <Kart><BosDurum ikon="receipt-outline" baslik="Onayınızı bekleyen masraf formu yok" /></Kart> : masraflar.map((m) => (
                <Kart key={m.id} style={{ marginBottom: aralik.s }}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                    <View style={{ flex: 1 }}>
                      <Metin tur="govdeKalin">{m.personel_ad || m.talep_eden_ad || "Personel"}</Metin>
                      <Metin tur="kucuk" renk={renk.metinIkincil} numberOfLines={1}>{[m.form_no ? `Form ${m.form_no}` : null, donemAdi(m.donem), `${m.kalem} kalem`, `${m.belge} fiş`].filter(Boolean).join(" · ")}</Metin>
                      <Metin tur="minik" renk={renk.metinSoluk}>{tarih(m.created_at)} · {ADIM_AD[m.adim] || m.adim}</Metin>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Metin tur="baslikM" style={[yazi.tutar, { fontWeight: "700" }]}>{tl(m.tutar)}</Metin>
                      {m.talep_firma && m.talep_firma !== "ERC" ? <Rozet metin={FIRMA_AD[m.talep_firma] || m.talep_firma} tonAdi="notr" style={{ marginTop: 4 }} /> : null}
                    </View>
                  </View>
                  <AkisAdimlari tur="masraf" durum={m.durum} kompakt />
                  {/* Dört işlem iki satırda: etiketler kısalmasın (iPhone genişliği) */}
                  <View style={{ flexDirection: "row", gap: aralik.xs, marginTop: aralik.s }}>
                    <Buton baslik="İncele (kalemler ve fişler)" tur="ikincil" kucuk ikon="receipt-outline" onPress={() => navigation.navigate("OnayMasrafDetay", { form: m })} style={{ flex: 1 }} />
                  </View>
                  <View style={{ flexDirection: "row", gap: aralik.xs, marginTop: aralik.xs }}>
                    <Buton baslik="Geri gönder" tur="ikincil" kucuk onPress={() => setGerekce({ tur: "masraf", islem: "iade", kayit: m, metin: "" })} devreDisi={!!isleniyor} style={{ flex: 1.5 }} />
                    {["PM", "DIREKTOR"].includes(m.adim) ? <Buton baslik="Reddet" tur="tehlike" kucuk onPress={() => setGerekce({ tur: "masraf", islem: "red", kayit: m, metin: "" })} devreDisi={!!isleniyor} style={{ flex: 1 }} /> : null}
                    <Buton baslik="Onayla" tur="basari" kucuk onPress={() => masrafOnayla(m)} yukleniyor={isleniyor === `m${m.id}`} devreDisi={!!isleniyor} style={{ flex: 1.1 }} />
                  </View>
                </Kart>
              ))}
            </>
          ) : null}

          {kat.malzeme?.yetkili ? (
            <>
              <BolumBasligi baslik={`Malzeme talepleri (${malzemeler.length})`} />
              {malzemeler.length === 0 ? <Kart><BosDurum ikon="cube-outline" baslik="Onayınızı bekleyen malzeme talebi yok" /></Kart> : malzemeler.map((m) => (
                <Kart key={m.id} style={{ marginBottom: aralik.s }}>
                  <Metin tur="govdeKalin">{m.talep_no} · {m.talep_eden_ad || "—"}</Metin>
                  <Metin tur="kucuk" renk={renk.metinIkincil}>{[m.bolge, m.proje, m.site_id, `${m.kalem_sayisi} kalem`].filter(Boolean).join(" · ")}</Metin>
                  <View style={{ flexDirection: "row", gap: aralik.xs, marginTop: aralik.s }}>
                    <Buton baslik="Reddet" tur="tehlike" kucuk onPress={() => setGerekce({ tur: "malzeme", islem: "red", kayit: m, metin: "" })} devreDisi={!!isleniyor} style={{ flex: 1 }} />
                    <Buton baslik="Onayla" tur="basari" kucuk onPress={() => malzemeOnayla(m)} yukleniyor={isleniyor === `z${m.id}`} devreDisi={!!isleniyor} style={{ flex: 1.2 }} />
                  </View>
                </Kart>
              ))}
            </>
          ) : null}

          {cu.veri?.yetkili ? (
            <>
              <BolumBasligi baslik={`Clean Up onayı (${cleanuplar.length})`} style={hicYetkiYok ? { marginTop: 0 } : undefined} />
              {cleanuplar.length === 0 ? <Kart><BosDurum ikon="construct-outline" baslik="Onayınızı bekleyen Clean Up yok" /></Kart> : cleanuplar.map((c) => {
                const pr = ilerleme(c);
                return (
                  <Kart key={c.id} style={{ marginBottom: aralik.s }} onPress={() => navigation.navigate("Cleanup", { site: c.site_code, onayModu: true })} erisimEtiketi={`${c.site_code} Clean Up, fotoğrafları incele`}>
                    <Metin tur="govdeKalin">{c.site_code}</Metin>
                    <Metin tur="kucuk" renk={renk.metinIkincil}>{[c.bolge, c.atanan_ad, `${pr.toplam} kalem`].filter(Boolean).join(" · ")}</Metin>
                    <Metin tur="minik" renk={renk.metinSoluk}>{c.onaya_gonderme_tarihi ? `Gönderildi ${tarih(c.onaya_gonderme_tarihi)}` : ""}</Metin>
                    <Metin tur="kucukKalin" renk={renk.lacivertAcik} style={{ marginTop: aralik.xs }}>Fotoğrafları incele →</Metin>
                  </Kart>
                );
              })}
            </>
          ) : null}
        </>
      ) : null}

      <AltSayfa gorunur={!!incele} kapat={() => setIncele(null)}>
        {incele ? (
          <>
            <Metin tur="baslikM" style={{ fontWeight: "700" }}>İş avansı · {incele.personel_ad || incele.talep_eden_ad}</Metin>
            <Metin tur="baslikXL" style={[yazi.tutar, { marginVertical: aralik.xs }]}>{tl(incele.tutar)}</Metin>
            <BilgiSatiri etiket="Kim için" deger={incele.personel_ad ? `${incele.personel_ad}${incele.personel_unvan ? ` (${incele.personel_unvan})` : ""}` : null} />
            <BilgiSatiri etiket="Talep eden" deger={incele.talep_eden_ad} />
            <BilgiSatiri etiket="Firma" deger={FIRMA_AD[incele.talep_firma] || incele.talep_firma} />
            <BilgiSatiri etiket="Gider türü" deger={incele.gider_turu} />
            <BilgiSatiri etiket="Proje" deger={incele.proje} />
            <BilgiSatiri etiket="Bölge" deger={incele.bolge} />
            <BilgiSatiri etiket="Plaka" deger={incele.plaka} />
            <BilgiSatiri etiket="Araç KM" deger={incele.arac_km != null && incele.arac_km !== "" ? Number(incele.arac_km).toLocaleString("tr-TR") : null} />
            <BilgiSatiri etiket="Tarih" deger={tarihUzun(incele.tarih || incele.created_at)} />
            <BilgiSatiri etiket="Onay aşaması" deger={ADIM_AD[incele.adim] || incele.adim} />
            <BilgiSatiri etiket="Not" deger={incele.not_aciklama} />
            <BilgiSatiri etiket="Açıklama" deger={incele.aciklama_ham ?? incele.aciklama} son />
            <Buton baslik="Onayla" tur="basari" onPress={() => avansOnayla(incele)} style={{ marginTop: aralik.m }} />
          </>
        ) : null}
      </AltSayfa>

      <GerekceSayfasi gerekce={gerekce} setGerekce={setGerekce} onGonder={gerekceGonder} />
    </Ekran>
  );
}

// ── Masraf formu incelemesi (onaycı): kalemler, fişler ve mevcut adımın işlemleri ──
export function OnayMasrafDetayEkrani({ route, navigation }) {
  const m = route.params.form;
  const { kullanici } = useOturum();
  const v = useVeri(`onayMasraf:${m.id}`, () => onayApi.masrafForm(m.id));
  const { calistir, isleniyor } = useOnayIslemi();
  const [gerekce, setGerekce] = useState(null);
  const [buyut, setBuyut] = useState(null);
  const f = v.veri;
  const kalemler = f?.kalemler || [];
  const toplam = kalemler.reduce((t, k) => t + Number(k.tutar || 0), 0);
  const geri = () => navigation.goBack();
  const onayla = () => Alert.alert("Masraf formunu onayla", `${m.personel_ad || m.talep_eden_ad || "Personel"} · ${tl(toplam || m.tutar)}\n${ADIM_AD[m.adim] || m.adim}`, [
    { text: "Vazgeç", style: "cancel" },
    { text: "Onayla", onPress: () => calistir(`m${m.id}`, () => onayApi.masrafOnayla(m.id, m.adim, "Omnix mobil üzerinden onaylandı."), "Onaylandı", geri) },
  ]);
  const gerekceGonder = () => {
    const g = gerekce;
    if (!g.metin.trim()) { Alert.alert("Gerekçe gerekli", g.islem === "iade" ? "Personelin neyi düzelteceğini kısaca yazın." : "Reddetme nedenini kısaca yazın."); return; }
    setGerekce(null);
    const metin = g.metin.trim();
    if (g.islem === "iade") calistir(`m${m.id}`, () => onayApi.masrafGeriGonder(m.id, metin, kullanici.email), "Personele geri gönderildi", geri);
    else calistir(`m${m.id}`, () => onayApi.masrafReddet(m.id, m.adim, metin, kullanici.email), "Reddedildi", geri);
  };
  const d = durumBilgisi("masraf", f?.durum || m.durum);
  return (
    <Ekran baslik={`Masraf formu${m.form_no ? ` ${m.form_no}` : ""}`} altBaslik={[m.personel_ad || m.talep_eden_ad, donemAdi(m.donem)].filter(Boolean).join(" · ")} yenileniyor={v.yenileniyor} onYenile={v.yenile}
      alt={(
        <View style={{ flexDirection: "row", gap: aralik.xs }}>
          <Buton baslik="Geri gönder" tur="ikincil" onPress={() => setGerekce({ islem: "iade", metin: "" })} devreDisi={!!isleniyor} style={{ flex: 1.7 }} />
          {["PM", "DIREKTOR"].includes(m.adim) ? <Buton baslik="Reddet" tur="tehlike" onPress={() => setGerekce({ islem: "red", metin: "" })} devreDisi={!!isleniyor} style={{ flex: 1 }} /> : null}
          <Buton baslik="Onayla" tur="basari" onPress={onayla} yukleniyor={isleniyor === `m${m.id}`} devreDisi={!!isleniyor || !f} style={{ flex: 1.1 }} />
        </View>
      )}>
      {v.yukleniyor && !f ? <><IskeletKart /><IskeletKart /></> : null}
      {v.hata && !f ? <Kart><HataDurum hata={v.hata} baslik="Form alınamadı" onTekrar={v.yenile} /></Kart> : null}
      {f ? (
        <>
          <Kart>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Metin tur="govdeKalin">{f.personel_ad || f.talep_eden_ad}</Metin>
                <Metin tur="kucuk" renk={renk.metinIkincil}>{[f.talep_eden_email, donemAdi(f.donem)].filter(Boolean).join(" · ")}</Metin>
              </View>
              <Rozet metin={d.ad} tonAdi={d.ton} />
            </View>
            <AkisAdimlari tur="masraf" durum={f.durum} />
            <BilgiSatiri etiket="Toplam" deger={tl(toplam)} />
            <BilgiSatiri etiket="Onay aşaması" deger={ADIM_AD[m.adim] || m.adim} />
            <BilgiSatiri etiket="Firma" deger={FIRMA_AD[m.talep_firma] || m.talep_firma} />
            <BilgiSatiri etiket="Oluşturma" deger={tarihUzun(f.created_at)} />
            <BilgiSatiri etiket="Önceki not" deger={[f.rollout_not, f.muhasebe_not, f.pm_not].filter(Boolean).join(" · ") || null} son />
          </Kart>
          <BolumBasligi baslik={`Kalemler (${kalemler.length})`} />
          {kalemler.length === 0 ? <Kart><BosDurum ikon="receipt-outline" baslik="Formda kalem yok" /></Kart> : kalemler.map((k) => {
            const belgeler = (k.belgeler || []).filter(Boolean);
            return (
              <Kart key={k.id} style={{ marginBottom: aralik.s }}>
                <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                  <View style={{ flex: 1 }}>
                    <Metin tur="govdeKalin">{k.kategori || "Harcama"}</Metin>
                    <Metin tur="kucuk" renk={renk.metinIkincil}>{[tarih(k.tarih), k.plaka, k.belge_no ? `Belge ${k.belge_no}` : null].filter(Boolean).join(" · ")}</Metin>
                    {k.aciklama ? <Metin tur="kucuk" style={{ marginTop: 2 }}>{k.aciklama}</Metin> : null}
                    {k.fis_var === false ? <Metin tur="minik" renk={renk.uyari} style={{ marginTop: 2 }}>Fiş yok: {k.belge_aciklama || "açıklama girilmemiş"}</Metin> : null}
                  </View>
                  <Metin tur="govdeKalin" style={yazi.tutar}>{tl(k.tutar)}</Metin>
                </View>
                {belgeler.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: aralik.s }}>
                    {belgeler.map((b) => (
                      <Pressable key={b.id} onPress={() => setBuyut(b)} accessibilityRole="imagebutton" accessibilityLabel="Fişi büyüt">
                        <Image source={{ uri: b.dosya_yolu }} style={{ width: 72, height: 96, borderRadius: kose.s, marginRight: aralik.xs, backgroundColor: renk.yuzeyIkincil }} />
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : null}
                {(k.notlar || []).length ? <Metin tur="minik" renk={renk.metinSoluk} style={{ marginTop: aralik.xs }}>{k.notlar.length} not</Metin> : null}
              </Kart>
            );
          })}
        </>
      ) : null}
      <Modal visible={!!buyut} animationType="fade" onRequestClose={() => setBuyut(null)}>
        <Pressable onPress={() => setBuyut(null)} style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }} accessibilityRole="button" accessibilityLabel="Kapat">
          {buyut ? <Image source={{ uri: buyut.dosya_yolu }} style={{ width: "100%", height: "90%" }} resizeMode="contain" /> : null}
          <View style={{ position: "absolute", top: 54, right: 20 }}><Ionicons name="close-circle" size={32} color="#fff" /></View>
        </Pressable>
      </Modal>
      <GerekceSayfasi gerekce={gerekce} setGerekce={setGerekce} onGonder={gerekceGonder} />
    </Ekran>
  );
}

function GerekceSayfasi({ gerekce, setGerekce, onGonder }) {
  const iade = gerekce?.islem === "iade";
  return (
    <AltSayfa gorunur={!!gerekce} kapat={() => setGerekce(null)}>
      {gerekce ? (
        <>
          <Metin tur="baslikM" style={{ fontWeight: "700", marginBottom: aralik.xs }}>{iade ? "Geri gönderme açıklaması" : "Reddetme gerekçesi"}</Metin>
          <Metin tur="kucuk" renk={renk.metinIkincil} style={{ marginBottom: aralik.s }}>{iade ? "Form personele taslak olarak döner; personel düzeltip yeniden onaya gönderir." : "Kayıt reddedilir; personel bu metni görür."}</Metin>
          <Alan cokSatir deger={gerekce.metin} onDegis={(x) => setGerekce({ ...gerekce, metin: x })} ipucu={iade ? "Ör. 2. kalemin fişi okunmuyor" : "Personel bu metni görecek"} autoFocus />
          <Buton baslik={iade ? "Geri gönder" : "Reddet"} tur={iade ? "birincil" : "tehlike"} onPress={onGonder} />
        </>
      ) : null}
    </AltSayfa>
  );
}

function AltSayfa({ gorunur, kapat, children }) {
  const alt = useSafeAreaInsets().bottom;
  return (
    <Modal visible={gorunur} animationType="slide" presentationStyle="pageSheet" onRequestClose={kapat}>
      <View style={{ flex: 1, backgroundColor: renk.yuzey, padding: aralik.m, paddingBottom: alt + aralik.m, borderTopLeftRadius: kose.l }}>
        <Buton baslik="Kapat" tur="metin" kucuk onPress={kapat} style={{ alignSelf: "flex-end" }} />
        {children}
      </View>
    </Modal>
  );
}
