// Harcamalar sekmesi: Masraflarım (taslak form, telefonda bekleyenler, geçmiş) ve Avanslarım.
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { aralik, kose, renk, yazi } from "../tema";
import { BolumBasligi, Buton, IkonKutu, Kart, Metin, Rozet, Satir } from "../bilesenler/temel";
import { Bant, BosDurum, HataDurum, IskeletKart } from "../bilesenler/durum";
import { AkisAdimlari } from "../bilesenler/AkisAdimlari";
import { Ekran } from "../bilesenler/Ekran";
import { useOturum } from "../oturum/OturumSaglayici";
import { useGecersizKil, useVeri } from "../api/veri";
import { avansApi, masrafApi } from "../api/uclar";
import { durumBilgisi } from "../mantik/durumlar";
import { donem, isoGun, tarih, tl, tutarCoz } from "../mantik/bicim";
import { hataMetni } from "../mantik/hata";
import { kategori } from "../mantik/sabitler";
import { taslaklar } from "../taslak/taslakDepo";

const benimMi = (f, k) => String(f.talep_eden_email || "").toLowerCase().trim() === String(k.email || "").toLowerCase().trim();

export function HarcamalarEkrani({ navigation, route }) {
  const [sekme, setSekme] = useState(route.params?.sekme || "masraf");
  useEffect(() => { if (route.params?.sekme) setSekme(route.params.sekme); }, [route.params?.sekme]);
  return (
    <Ekran baslik="Harcamalar" geri={false} sag={null}>
      <Segment secenekler={[{ id: "masraf", ad: "Masraflarım" }, { id: "avans", ad: "İş avanslarım" }]} deger={sekme} onSec={setSekme} />
      {sekme === "masraf" ? <Masraflarim navigation={navigation} /> : <Avanslarim navigation={navigation} />}
    </Ekran>
  );
}

export function Segment({ secenekler, deger, onSec }) {
  return (
    <View style={{ flexDirection: "row", backgroundColor: "#E4E9F0", borderRadius: kose.m, padding: 3, marginBottom: aralik.m }} accessibilityRole="tablist">
      {secenekler.map((s) => {
        const sec = s.id === deger;
        return (
          <Pressable key={s.id} onPress={() => onSec(s.id)} accessibilityRole="tab" accessibilityState={{ selected: sec }}
            style={{ flex: 1, minHeight: 40, borderRadius: kose.m - 2, alignItems: "center", justifyContent: "center", backgroundColor: sec ? renk.yuzey : "transparent" }}>
            <Metin tur="kucukKalin" renk={sec ? renk.metin : renk.metinIkincil}>{s.ad}</Metin>
          </Pressable>
        );
      })}
    </View>
  );
}

function Masraflarim({ navigation }) {
  const { kullanici, kapsam } = useOturum();
  const formlar = useVeri("masrafFormlar", () => masrafApi.formlar());
  const gecersizKil = useGecersizKil();
  const [yerel, setYerel] = useState([]);
  const [aciliyor, setAciliyor] = useState(false);

  useFocusEffect(useCallback(() => {
    let iptal = false;
    taslaklar(kapsam, "masrafKalem").then((t) => { if (!iptal) setYerel(t); });
    return () => { iptal = true; };
  }, [kapsam]));

  const benim = (Array.isArray(formlar.veri) ? formlar.veri : []).filter((f) => benimMi(f, kullanici));
  const taslakForm = benim.find((f) => f.durum === "TASLAK");
  const gecmis = benim.filter((f) => f.durum !== "TASLAK");

  const taslakAc = async () => {
    if (aciliyor) return;
    setAciliyor(true);
    try {
      const f = await masrafApi.taslakAc(kullanici, isoGun().slice(0, 7));
      gecersizKil(["masrafFormlar", "hesap", "pano"]);
      navigation.navigate("MasrafForm", { formId: f.id });
    } catch (e) {
      Alert.alert("Masraf formu açılamadı", hataMetni(e));
    } finally {
      setAciliyor(false);
    }
  };

  return (
    <View>
      {yerel.length ? (
        <>
          <BolumBasligi baslik="Telefonda bekleyen kalemler" style={{ marginTop: 0 }} />
          <Kart style={{ paddingVertical: 0, marginBottom: aralik.s }}>
            {yerel.map((t, i) => {
              const ham = t.alanlarHam || t.alanlar || {};
              const kat = kategori(ham.kategori);
              const tutar = t.alanlar?.tutar ?? tutarCoz(ham.tutarMetni);
              return (
                <Satir key={t.id} ikon={kat.ikon} ikonTon={t.gonderimHatasi ? "uyari" : "notr"} baslik={ham.kategori ? kat.ad : "Tür seçilmedi"}
                  alt={t.gonderimHatasi ? "Gönderilemedi · dokunup tekrar deneyin" : "Taslak · henüz gönderilmedi"}
                  sag={tl(tutar) || "—"} onPress={() => navigation.navigate("KalemEkle", { formId: t.formId, taslakId: t.id })} son={i === yerel.length - 1} />
              );
            })}
          </Kart>
        </>
      ) : null}

      {formlar.yukleniyor && !formlar.veri ? <><IskeletKart yukseklik={120} /><IskeletKart /></> : null}
      {formlar.hata && !formlar.veri ? <Kart><HataDurum hata={formlar.hata} onTekrar={formlar.yenile} /></Kart> : null}

      {formlar.veri ? (
        <>
          {taslakForm ? (
            <Kart onPress={() => navigation.navigate("MasrafForm", { formId: taslakForm.id })} erisimEtiketi="Taslak masraf formuna devam et">
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <IkonKutu ad="create-outline" tonAdi="uyari" />
                <View style={{ flex: 1, marginLeft: aralik.s }}>
                  <Metin tur="govdeKalin">Taslak masraf formu</Metin>
                  <Metin tur="kucuk" renk={renk.metinIkincil}>{donem(taslakForm.donem)} · Onaya gönderilmedi</Metin>
                </View>
                <Metin tur="govdeKalin" style={yazi.tutar}>{tl(taslakForm.genel_toplam) || "—"}</Metin>
              </View>
              <Buton baslik="Devam et" ikon="arrow-forward" onPress={() => navigation.navigate("MasrafForm", { formId: taslakForm.id })} style={{ marginTop: aralik.m }} />
            </Kart>
          ) : (
            <Kart>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <IkonKutu ad="receipt-outline" />
                <View style={{ flex: 1, marginLeft: aralik.s }}>
                  <Metin tur="govdeKalin">Yeni masraf</Metin>
                  <Metin tur="kucuk" renk={renk.metinIkincil}>Harcamalarınızı fişleriyle ekleyin, ay sonunda onaya gönderin.</Metin>
                </View>
              </View>
              <Buton baslik="Masraf formu başlat" ikon="add" onPress={taslakAc} yukleniyor={aciliyor} style={{ marginTop: aralik.m }} />
            </Kart>
          )}

          <BolumBasligi baslik="Gönderdiğim formlar" />
          {gecmis.length === 0 ? (
            <Kart><BosDurum ikon="documents-outline" baslik="Henüz gönderilmiş masraf formunuz yok" /></Kart>
          ) : (
            <Kart style={{ paddingVertical: aralik.xs }}>
              {gecmis.map((f, i) => {
                const d = durumBilgisi("masraf", f.durum);
                return (
                  <Pressable key={f.id} onPress={() => navigation.navigate("MasrafForm", { formId: f.id })} accessibilityRole="button"
                    accessibilityLabel={`${donem(f.donem) || "Masraf formu"}, ${d.ad}, ${tl(f.genel_toplam)}`}
                    style={{ paddingVertical: aralik.s, borderBottomWidth: i === gecmis.length - 1 ? 0 : 0.5, borderBottomColor: renk.cizgi }}>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <View style={{ flex: 1 }}>
                        <Metin tur="govdeKalin">{donem(f.donem) || "Masraf formu"}</Metin>
                        <Metin tur="minik" renk={renk.metinSoluk}>{f.form_no ? `Form MF.${String(f.form_no).padStart(3, "0")}` : `#${f.id}`} · {tarih(f.created_at)}</Metin>
                      </View>
                      <Metin tur="govdeKalin" style={yazi.tutar}>{tl(f.genel_toplam) || "—"}</Metin>
                    </View>
                    <Rozet metin={d.ad} tonAdi={d.ton} style={{ marginTop: 6 }} />
                    {!d.bitti && !d.red ? <AkisAdimlari tur="masraf" durum={f.durum} kompakt /> : null}
                  </Pressable>
                );
              })}
            </Kart>
          )}
          {formlar.hata ? <Bant tonAdi="uyari" metin="Liste güncellenemedi; gördüğünüz bilgiler eski olabilir." style={{ marginTop: aralik.s }} /> : null}
        </>
      ) : null}
    </View>
  );
}

function Avanslarim({ navigation }) {
  const { kullanici } = useOturum();
  const liste = useVeri("avanslar", () => avansApi.listem(kullanici));
  const rows = Array.isArray(liste.veri) ? liste.veri : [];
  return (
    <View>
      <Buton baslik="Yeni iş avansı talebi" ikon="add" onPress={() => navigation.navigate("AvansTalep")} />
      <BolumBasligi baslik="Taleplerim" />
      {liste.yukleniyor && !liste.veri ? <><IskeletKart /><IskeletKart /></> : null}
      {liste.hata && !liste.veri ? <Kart><HataDurum hata={liste.hata} onTekrar={liste.yenile} /></Kart> : null}
      {liste.veri && rows.length === 0 ? <Kart><BosDurum ikon="wallet-outline" baslik="Henüz iş avansı talebiniz yok" aciklama="Saha giderleri için önceden avans isteyebilirsiniz." /></Kart> : null}
      {rows.length ? (
        <Kart style={{ paddingVertical: aralik.xs }}>
          {rows.map((a, i) => {
            const d = durumBilgisi("avans", a.durum);
            const kimIcin = a.personel_ad && String(a.personel_email || "").toLowerCase() !== String(kullanici.email).toLowerCase() ? a.personel_ad : null;
            return (
              <Pressable key={a.id} onPress={() => navigation.navigate("AvansDetay", { avans: a })} accessibilityRole="button"
                accessibilityLabel={`${a.gider_turu || "İş avansı"} ${tl(a.tutar)}, ${d.ad}`}
                style={{ paddingVertical: aralik.s, borderBottomWidth: i === rows.length - 1 ? 0 : 0.5, borderBottomColor: renk.cizgi }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Metin tur="govdeKalin" numberOfLines={1}>{[a.gider_turu, a.proje].filter(Boolean).join(" · ") || "İş avansı"}</Metin>
                    <Metin tur="minik" renk={renk.metinSoluk}>{[tarih(a.tarih || a.created_at), a.bolge, kimIcin ? `Kim için: ${kimIcin}` : null].filter(Boolean).join(" · ")}</Metin>
                  </View>
                  <Metin tur="govdeKalin" style={yazi.tutar}>{tl(a.tutar) || "—"}</Metin>
                </View>
                <Rozet metin={d.ad} tonAdi={d.ton} style={{ marginTop: 6 }} />
                {!d.bitti && !d.red ? <AkisAdimlari tur="avans" durum={a.durum} kompakt /> : null}
              </Pressable>
            );
          })}
        </Kart>
      ) : null}
    </View>
  );
}
