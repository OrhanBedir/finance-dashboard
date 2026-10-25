// Onaylar (yalnız backend'in onaycı olarak işaretlediği kullanıcılar görür; her adımın yetkisi yine backend'de denetlenir).
// Kurgu eski mobil/web ile aynı: avans onayında gider hangi firmanın kasasından çıkacak sorulur.
import React, { useRef, useState } from "react";
import { Alert, Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { aralik, kose, renk, yazi } from "../tema";
import { BilgiSatiri, BolumBasligi, Buton, Kart, Metin } from "../bilesenler/temel";
import { BosDurum, HataDurum, IskeletKart } from "../bilesenler/durum";
import { Alan } from "../bilesenler/form";
import { AkisAdimlari } from "../bilesenler/AkisAdimlari";
import { Ekran } from "../bilesenler/Ekran";
import { useOturum } from "../oturum/OturumSaglayici";
import { useGecersizKil, useVeri } from "../api/veri";
import { avansApi, cleanupApi, malzemeApi, panoApi } from "../api/uclar";
import { tarih, tarihUzun, tl } from "../mantik/bicim";
import { hataMetni } from "../mantik/hata";
import { ilerleme } from "../mantik/cleanup";

// Onayda sorulan kasa seçenekleri (16.09 / 14.10.2026 kararı; backend kodları ERC / TEKNO)
const KASA = [{ kod: "ERC", ad: "Şimşek" }, { kod: "TEKNO", ad: "Teknocenter" }];

export function OnaylarEkrani({ navigation }) {
  const { kullanici } = useOturum();
  const gecersizKil = useGecersizKil();
  const pano = useVeri("pano", () => panoApi.pano(kullanici));
  const [incele, setIncele] = useState(null);
  const [red, setRed] = useState(null); // { tur, kayit, metin }
  const [isleniyor, setIsleniyor] = useState(null);
  const kilit = useRef(false);
  const p = pano.veri;
  const avanslar = p?.onayBekleyenAvanslar || [];
  const malzemeler = p?.isPM ? p?.onayBekleyenMalzemeler || [] : [];
  // Clean Up: yalnız bu kullanıcının bölgesindeki (backend süzer) onaya gönderilmiş sahalar
  const cu = useVeri("cleanupOnay", () => cleanupApi.onayBekleyen());
  const cleanuplar = cu.veri?.rows || [];
  const avansOnaycisi = !!(p && (p.isPM || p.isDirektor || p.isRM));

  const calistir = async (id, is, mesaj) => {
    if (kilit.current) return;
    kilit.current = true;
    setIsleniyor(id);
    try {
      await is();
      gecersizKil(["pano"]);
      if (mesaj) Alert.alert(mesaj);
    } catch (e) {
      gecersizKil(["pano"]); // sonuç belirsizse güncel liste gösterilir: işlenen kayıt listeden düşer
      Alert.alert("İşlem tamamlanamadı", e?.sonucBelirsiz ? "Bağlantı koptu. Liste yenilendi; kayıt hâlâ listedeyse tekrar deneyin." : hataMetni(e));
    } finally { kilit.current = false; setIsleniyor(null); }
  };

  const avansOnayla = (a) => {
    setIncele(null);
    Alert.alert("Avansı onayla — hangi kasa?", `${a.talep_eden_ad || "Personel"} · ${tl(a.tutar)}\n${[a.proje, a.gider_turu].filter(Boolean).join(" · ")}\n\nBu gider hangi firmanın kasasından çıkacak?`, [
      { text: "Vazgeç", style: "cancel" },
      ...KASA.map((k) => ({ text: k.ad, onPress: () => calistir(a.id, () => avansApi.onayla(a.id, k.kod, !!p?.isDirektor), "Onaylandı") })),
    ]);
  };

  const malzemeOnayla = (m) => Alert.alert("Malzeme talebini onayla", `${m.talep_no} · ${m.talep_eden_ad || ""}\n${m.kalem_sayisi} kalem`, [
    { text: "Vazgeç", style: "cancel" },
    { text: "Onayla", onPress: () => calistir(`m${m.id}`, () => malzemeApi.durum(m.id, { durum: "FIYAT_GIRISI", onay_notu: "Omnix mobil üzerinden onaylandı." }), "Onaylandı") },
  ]);

  const redGonder = () => {
    const r = red;
    if (!r.metin.trim()) { Alert.alert("Gerekçe gerekli", "Reddetme nedenini kısaca yazın."); return; }
    setRed(null);
    if (r.tur === "avans") calistir(r.kayit.id, () => avansApi.reddet(r.kayit.id, r.metin.trim(), kullanici.email), "Reddedildi");
    else calistir(`m${r.kayit.id}`, () => malzemeApi.durum(r.kayit.id, { durum: "REDDEDILDI", notlar: r.metin.trim() }), "Reddedildi");
  };

  return (
    <Ekran baslik="Onaylar" geri={false} yenileniyor={pano.yenileniyor} onYenile={() => { pano.yenile(); cu.yenile(); }}>
      {pano.yukleniyor && !p ? <><IskeletKart /><IskeletKart /></> : null}
      {pano.hata && !p ? <Kart><HataDurum hata={pano.hata} onTekrar={pano.yenile} /></Kart> : null}
      {p ? (
        <>
          {avansOnaycisi ? <BolumBasligi baslik={`İş avansı talepleri (${avanslar.length})`} style={{ marginTop: 0 }} /> : null}
          {!avansOnaycisi ? null : avanslar.length === 0 ? <Kart><BosDurum ikon="checkmark-done-outline" baslik="Onayınızı bekleyen avans yok" /></Kart> : avanslar.map((a) => (
            <Kart key={a.id} style={{ marginBottom: aralik.s }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}>
                  <Metin tur="govdeKalin">{a.talep_eden_ad || "Personel"}</Metin>
                  <Metin tur="kucuk" renk={renk.metinIkincil} numberOfLines={1}>{[a.gider_turu, a.proje, a.bolge].filter(Boolean).join(" · ")}</Metin>
                  <Metin tur="minik" renk={renk.metinSoluk}>{tarih(a.tarih || a.created_at)}{a.personel_ad ? ` · Kim için: ${a.personel_ad}` : ""}</Metin>
                </View>
                <Metin tur="baslikM" style={[yazi.tutar, { fontWeight: "700" }]}>{tl(a.tutar)}</Metin>
              </View>
              <AkisAdimlari tur="avans" durum={a.durum} kompakt />
              <View style={{ flexDirection: "row", gap: aralik.xs, marginTop: aralik.s }}>
                <Buton baslik="İncele" tur="ikincil" kucuk onPress={() => setIncele(a)} style={{ flex: 1 }} />
                <Buton baslik="Reddet" tur="tehlike" kucuk onPress={() => setRed({ tur: "avans", kayit: a, metin: "" })} devreDisi={!!isleniyor} style={{ flex: 1 }} />
                <Buton baslik="Onayla" tur="basari" kucuk onPress={() => avansOnayla(a)} yukleniyor={isleniyor === a.id} devreDisi={!!isleniyor} style={{ flex: 1.2 }} />
              </View>
            </Kart>
          ))}
          {p.isPM ? (
            <>
              <BolumBasligi baslik={`Malzeme talepleri (${malzemeler.length})`} />
              {malzemeler.length === 0 ? <Kart><BosDurum ikon="cube-outline" baslik="Onayınızı bekleyen malzeme talebi yok" /></Kart> : malzemeler.map((m) => (
                <Kart key={m.id} style={{ marginBottom: aralik.s }}>
                  <Metin tur="govdeKalin">{m.talep_no} · {m.talep_eden_ad || "—"}</Metin>
                  <Metin tur="kucuk" renk={renk.metinIkincil}>{[m.bolge, m.proje, m.site_id, `${m.kalem_sayisi} kalem`].filter(Boolean).join(" · ")}</Metin>
                  <View style={{ flexDirection: "row", gap: aralik.xs, marginTop: aralik.s }}>
                    <Buton baslik="Reddet" tur="tehlike" kucuk onPress={() => setRed({ tur: "malzeme", kayit: m, metin: "" })} devreDisi={!!isleniyor} style={{ flex: 1 }} />
                    <Buton baslik="Onayla" tur="basari" kucuk onPress={() => malzemeOnayla(m)} yukleniyor={isleniyor === `m${m.id}`} devreDisi={!!isleniyor} style={{ flex: 1.2 }} />
                  </View>
                </Kart>
              ))}
            </>
          ) : null}
          {cu.veri?.yetkili ? (
            <>
              <BolumBasligi baslik={`Clean Up onayı (${cleanuplar.length})`} style={avansOnaycisi ? undefined : { marginTop: 0 }} />
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
            <Metin tur="baslikM" style={{ fontWeight: "700" }}>İş avansı · {incele.talep_eden_ad}</Metin>
            <Metin tur="baslikXL" style={[yazi.tutar, { marginVertical: aralik.xs }]}>{tl(incele.tutar)}</Metin>
            <BilgiSatiri etiket="Kim için" deger={incele.personel_ad ? `${incele.personel_ad}${incele.personel_unvan ? ` (${incele.personel_unvan})` : ""}` : null} />
            <BilgiSatiri etiket="Gider türü" deger={incele.gider_turu} />
            <BilgiSatiri etiket="Proje" deger={incele.proje} />
            <BilgiSatiri etiket="Bölge" deger={incele.bolge} />
            <BilgiSatiri etiket="Plaka" deger={incele.plaka} />
            <BilgiSatiri etiket="Araç KM" deger={incele.arac_km != null && incele.arac_km !== "" ? Number(incele.arac_km).toLocaleString("tr-TR") : null} />
            <BilgiSatiri etiket="Tarih" deger={tarihUzun(incele.tarih || incele.created_at)} />
            <BilgiSatiri etiket="Not" deger={incele.not_aciklama} />
            <BilgiSatiri etiket="Açıklama" deger={incele.aciklama_ham ?? incele.aciklama} son />
            <Buton baslik="Onayla" tur="basari" onPress={() => avansOnayla(incele)} style={{ marginTop: aralik.m }} />
          </>
        ) : null}
      </AltSayfa>

      <AltSayfa gorunur={!!red} kapat={() => setRed(null)}>
        {red ? (
          <>
            <Metin tur="baslikM" style={{ fontWeight: "700", marginBottom: aralik.s }}>Reddetme gerekçesi</Metin>
            <Alan cokSatir deger={red.metin} onDegis={(x) => setRed({ ...red, metin: x })} ipucu="Personel bu metni görecek" autoFocus />
            <Buton baslik="Reddet" tur="tehlike" onPress={redGonder} />
          </>
        ) : null}
      </AltSayfa>
    </Ekran>
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
