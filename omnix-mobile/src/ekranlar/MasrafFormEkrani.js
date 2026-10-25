// Masraf formu: kalemler, fiş durumları, onay akışı ve "Onaya gönder". Onaya gönderilmiş form kilitlidir.
import React, { useRef, useState } from "react";
import { Alert, Image, Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { aralik, kose, renk, yazi } from "../tema";
import { BolumBasligi, Buton, IkonKutu, Kart, Metin, Rozet } from "../bilesenler/temel";
import { Bant, BosDurum, HataDurum, IskeletKart } from "../bilesenler/durum";
import { AkisAdimlari } from "../bilesenler/AkisAdimlari";
import { Ekran } from "../bilesenler/Ekran";
import { useGecersizKil, useVeri } from "../api/veri";
import { masrafApi } from "../api/uclar";
import { durumBilgisi } from "../mantik/durumlar";
import { donem, tarih, tl } from "../mantik/bicim";
import { hataMetni } from "../mantik/hata";
import { kategori } from "../mantik/sabitler";

export function MasrafFormEkrani({ navigation, route }) {
  const { formId } = route.params;
  const anahtar = `masrafForm:${formId}`;
  const form = useVeri(anahtar, () => masrafApi.form(formId));
  const gecersizKil = useGecersizKil();
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [gonderildi, setGonderildi] = useState(false);
  const kilit = useRef(false);

  const f = form.veri;
  const d = f ? durumBilgisi("masraf", f.durum) : null;
  const duzenlenebilir = f?.durum === "TASLAK";
  const kalemler = f?.kalemler || [];
  const toplam = kalemler.reduce((t, k) => t + (Number(k.tutar) || 0), 0);
  const fisEksik = kalemler.filter((k) => k.fis_var !== false && !(k.belgeler || []).filter(Boolean).length);

  const kalemSil = (k) => {
    Alert.alert("Kalemi sil", `${kategori(k.kategori).ad} · ${tl(k.tutar)} silinsin mi? Eklenen fişler de silinir.`, [
      { text: "Vazgeç", style: "cancel" },
      { text: "Sil", style: "destructive", onPress: async () => {
        try {
          await masrafApi.kalemSil(k.id);
          gecersizKil([anahtar, "masrafFormlar", "hesap", "pano"]);
        } catch (e) { Alert.alert("Kalem silinemedi", hataMetni(e)); }
      } },
    ]);
  };

  const gonder = async () => {
    if (kilit.current) return;
    kilit.current = true;
    setGonderiliyor(true);
    try {
      await masrafApi.gonder(formId);
      basarili();
    } catch (e) {
      // Bağlantı koptuysa ya da form zaten gönderildiyse: sunucudaki durumu oku, gönderildiyse başarı say
      try {
        const g = await masrafApi.form(formId);
        if (g?.durum && g.durum !== "TASLAK") { basarili(); return; }
      } catch {}
      Alert.alert("Form gönderilemedi", e?.sonucBelirsiz ? "Bağlantı sorunu nedeniyle gönderilemedi. Formunuz taslak olarak duruyor; tekrar deneyin." : hataMetni(e));
    } finally {
      kilit.current = false;
      setGonderiliyor(false);
    }
  };

  // Başarı ekranda kalıcı bantla gösterilir (art arda iki uyarı penceresi iOS'ta kaybolabiliyor)
  const basarili = () => {
    gecersizKil([anahtar, "masrafFormlar", "hesap", "pano"]);
    setGonderildi(true);
  };

  const onayaGonder = () => {
    if (!kalemler.length) { Alert.alert("Kalem yok", "Onaya göndermeden önce en az bir masraf kalemi ekleyin."); return; }
    const uyari = fisEksik.length ? `\n\n${fisEksik.length} kalemde fiş yok. Fişsiz kalemler onayda geri çevrilebilir.` : "";
    Alert.alert("Onaya gönderilsin mi?", `${kalemler.length} kalem · ${tl(toplam)}\nGönderdikten sonra kalem ekleyemez ve değiştiremezsiniz.${uyari}`, [
      { text: "Vazgeç", style: "cancel" },
      { text: "Onaya gönder", onPress: gonder },
    ]);
  };

  return (
    <Ekran
      baslik="Masraf formu"
      altBaslik={f ? [donem(f.donem), f.form_no ? `MF.${String(f.form_no).padStart(3, "0")}` : null].filter(Boolean).join(" · ") : undefined}
      yenileniyor={form.yenileniyor}
      onYenile={form.yenile}
      alt={duzenlenebilir ? (
        <View style={{ flexDirection: "row", gap: aralik.s }}>
          <Buton baslik="Kalem ekle" ikon="add" tur="ikincil" onPress={() => navigation.navigate("KalemEkle", { formId })} style={{ flex: 1 }} />
          <Buton baslik="Onaya gönder" ikon="paper-plane-outline" onPress={onayaGonder} yukleniyor={gonderiliyor} style={{ flex: 1.2 }} devreDisi={!kalemler.length} />
        </View>
      ) : null}
    >
      {form.yukleniyor && !f ? <><IskeletKart yukseklik={140} /><IskeletKart /><IskeletKart /></> : null}
      {form.hata && !f ? <Kart><HataDurum hata={form.hata} onTekrar={form.yenile} /></Kart> : null}
      {f ? (
        <>
          <Kart>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <Metin tur="etiket" renk={renk.metinIkincil}>Toplam</Metin>
                <Metin tur="baslikXL" style={yazi.tutar}>{tl(toplam)}</Metin>
                <Metin tur="kucuk" renk={renk.metinIkincil}>{kalemler.length} kalem</Metin>
              </View>
              <Rozet metin={d.ad} tonAdi={d.ton} />
            </View>
            <View style={{ marginTop: aralik.m }}><AkisAdimlari tur="masraf" durum={f.durum} /></View>
            {f.durum === "REDDEDILDI" && f.red_aciklama ? <Bant tonAdi="hata" baslik="Ret / iade gerekçesi" metin={String(f.red_aciklama).replace(/^↩\s*GERİ GÖNDERİLDİ:\s*/, "")} style={{ marginTop: aralik.m }} /> : null}
          </Kart>

          {gonderildi && !duzenlenebilir ? (
            <Bant tonAdi="basari" style={{ marginTop: aralik.s }} baslik="Onaya gönderildi" metin="Masraf formunuz onay sürecine girdi. Durumunu bu ekrandan ve Harcamalar sekmesinden takip edebilirsiniz." />
          ) : !duzenlenebilir ? (
            <Bant tonAdi="bilgi" ikon="lock-closed-outline" style={{ marginTop: aralik.s }}
              metin={f.durum === "REDDEDILDI" ? "Bu form reddedildi; değişiklik yapılamaz. Gerekirse yeni bir masraf formu başlatın." : "Form onay sürecinde. Kalem ve fiş değişikliği yapılamaz."} />
          ) : fisEksik.length ? (
            <Bant tonAdi="uyari" style={{ marginTop: aralik.s }} metin={`${fisEksik.length} kalemde fiş eksik. Fişi olmayan kalem için nedenini yazın.`} />
          ) : null}

          <BolumBasligi baslik="Kalemler" />
          {kalemler.length === 0 ? (
            <Kart><BosDurum ikon="receipt-outline" baslik="Henüz kalem yok" aciklama="Harcamanızı ekleyip fişin fotoğrafını çekin." eylem={duzenlenebilir ? "Kalem ekle" : undefined} onEylem={() => navigation.navigate("KalemEkle", { formId })} /></Kart>
          ) : kalemler.map((k) => <KalemKarti key={k.id} k={k} duzenlenebilir={duzenlenebilir} onSil={() => kalemSil(k)}
            onFisEkle={() => navigation.navigate("KalemEkle", { formId, mevcutKalem: k })} />)}
        </>
      ) : null}
    </Ekran>
  );
}

function KalemKarti({ k, duzenlenebilir, onSil, onFisEkle }) {
  const kat = kategori(k.kategori);
  const belgeler = (k.belgeler || []).filter(Boolean);
  const fisDurum = belgeler.length
    ? { metin: `${belgeler.length} fiş eklendi`, ton: "basari", ikon: "document-attach-outline" }
    : k.fis_var === false
      ? { metin: "Fişsiz (açıklamalı)", ton: "notr", ikon: "document-outline" }
      : { metin: "Fiş eksik", ton: "uyari", ikon: "alert-circle-outline" };
  return (
    <Kart style={{ marginBottom: aralik.s }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <IkonKutu ad={kat.ikon} />
        <View style={{ flex: 1, marginLeft: aralik.s, minWidth: 0 }}>
          <Metin tur="govdeKalin">{kat.ad}</Metin>
          <Metin tur="kucuk" renk={renk.metinIkincil} numberOfLines={2}>{[tarih(k.tarih), k.plaka, k.aciklama].filter(Boolean).join(" · ")}</Metin>
        </View>
        <Metin tur="govdeKalin" style={[yazi.tutar, { marginLeft: aralik.xs }]}>{tl(k.tutar)}</Metin>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: aralik.s }}>
        <Rozet metin={fisDurum.metin} tonAdi={fisDurum.ton} ikon={fisDurum.ikon} />
        <View style={{ flex: 1 }} />
        {duzenlenebilir ? (
          <Pressable onPress={onFisEkle} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${kat.ad} kalemine fiş ekle`}
            style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, marginRight: 4 }}>
            <Ionicons name="camera-outline" size={18} color={renk.lacivertAcik} />
            <Metin tur="kucukKalin" renk={renk.lacivertAcik} style={{ marginLeft: 4 }}>{belgeler.length ? "Fiş ekle" : k.fis_var === false ? "Fiş ekle" : "Fiş ekle / açıkla"}</Metin>
          </Pressable>
        ) : null}
        {duzenlenebilir ? (
          <Pressable onPress={onSil} hitSlop={10} accessibilityRole="button" accessibilityLabel={`${kat.ad} kalemini sil`} style={{ padding: 6 }}>
            <Ionicons name="trash-outline" size={20} color={renk.hata} />
          </Pressable>
        ) : null}
      </View>
      {k.fis_var === false && k.fis_olmadan_aciklama ? <Metin tur="minik" renk={renk.metinIkincil} style={{ marginTop: 6 }}>Fişsiz nedeni: {k.fis_olmadan_aciklama}</Metin> : null}
      {belgeler.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: aralik.s }}>
          {belgeler.map((b) => (
            b.dosya_yolu && /^https?:/.test(b.dosya_yolu) ? (
              <Image key={b.id} source={{ uri: b.dosya_yolu }} style={{ width: 64, height: 84, borderRadius: kose.s, marginRight: aralik.xs, backgroundColor: renk.yuzeyIkincil }}
                accessibilityLabel="Fiş fotoğrafı" />
            ) : null
          ))}
        </ScrollView>
      ) : null}
    </Kart>
  );
}
