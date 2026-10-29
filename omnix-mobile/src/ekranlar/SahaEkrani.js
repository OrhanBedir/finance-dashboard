// Saha sekmesi: Rollout işlerim, malzeme taleplerim, üzerimdeki (zimmetli) malzemeler.
import React, { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { aralik, renk } from "../tema";
import { BolumBasligi, Buton, Kart, Metin, Rozet } from "../bilesenler/temel";
import { BosDurum, EskiVeriBandi, HataDurum, IskeletKart } from "../bilesenler/durum";
import { Alan } from "../bilesenler/form";
import { Ekran } from "../bilesenler/Ekran";
import { Segment } from "./HarcamalarEkrani";
import { useOturum } from "../oturum/OturumSaglayici";
import { useGecersizKil, useVeri } from "../api/veri";
import { cleanupApi, isApi, malzemeApi } from "../api/uclar";
import { durumBilgisi } from "../mantik/durumlar";
import { tarih } from "../mantik/bicim";
import { hataMetni } from "../mantik/hata";
import { ilerleme } from "../mantik/cleanup";
import { Malzemelerim } from "./StokEkranlari";

export function SahaEkrani({ navigation }) {
  const [sekme, setSekme] = useState("is");
  return (
    <Ekran baslik="Saha" geri={false}>
      <Segment secenekler={[{ id: "is", ad: "İşlerim" }, { id: "zimmet", ad: "Malzemelerim" }, { id: "malzeme", ad: "Taleplerim" }]} deger={sekme} onSec={setSekme} />
      {/* 29.10.2026: Malzemelerim stok defterinden gelir; defter açılana kadar eski zimmet listesi (salt bilgi) gösterilir */}
      {sekme === "is" ? <Islerim navigation={navigation} /> : sekme === "malzeme" ? <MalzemeTaleplerim navigation={navigation} /> : <Malzemelerim navigation={navigation} eski={<Zimmetim />} />}
    </Ekran>
  );
}

function Islerim({ navigation }) {
  const v = useVeri("isler", () => isApi.benim());
  const bekleyen = v.veri?.bekleyen || [];
  const tamam = v.veri?.tamamlanan || [];
  if (v.yukleniyor && !v.veri) return <><IskeletKart /><IskeletKart /></>;
  if (v.hata && !v.veri) return <Kart><HataDurum hata={v.hata} onTekrar={v.yenile} /></Kart>;
  return (
    <View>
      <EskiVeriBandi v={v} style={{ marginBottom: aralik.s }} />
      {bekleyen.length === 0 ? <Kart><BosDurum ikon="navigate-outline" baslik="Size atanmış açık iş yok" aciklama="Merkezden iş atandığında burada görünür." /></Kart>
        : bekleyen.map((r) => <IsKarti key={r.id} r={r} onPress={() => navigation.navigate("IsDetay", { is: r })} />)}
      <CleanupSahalarim navigation={navigation} />
      {tamam.length ? (
        <>
          <BolumBasligi baslik="Son 60 günde kapananlar" />
          {tamam.slice(0, 20).map((r) => <IsKarti key={r.id} r={r} onPress={() => navigation.navigate("IsDetay", { is: r })} />)}
        </>
      ) : null}
    </View>
  );
}

// Ofisin bana atadığı, henüz onaylanmamış Clean Up sahaları (atama olmadan da Site ID ile açılabilir)
function CleanupSahalarim({ navigation }) {
  const v = useVeri("cleanupAtanan", async () => (await cleanupApi.atananlarim()).rows || []);
  const rows = Array.isArray(v.veri) ? v.veri : [];
  return (
    <View>
      <BolumBasligi baslik={`Clean Up sahalarım${rows.length ? ` (${rows.length})` : ""}`} eylem="Site ID ile aç" onEylem={() => navigation.navigate("Cleanup", {})} />
      {v.hata && !v.veri ? <Kart><HataDurum hata={v.hata} onTekrar={v.yenile} /></Kart> : null}
      <EskiVeriBandi v={v} style={{ marginBottom: aralik.s }} />
      {v.veri && rows.length === 0 ? <Kart><BosDurum ikon="construct-outline" baslik="Size atanmış Clean Up sahası yok" aciklama="Ofis atadığında burada görünür." /></Kart> : null}
      {rows.map((c) => {
        const d = durumBilgisi("cleanup", c.onay_durum || "TASLAK");
        const p = ilerleme(c);
        return (
          <Kart key={c.id} style={{ marginBottom: aralik.s }} onPress={() => navigation.navigate("Cleanup", { site: c.site_code })} erisimEtiketi={`${c.site_code}, Clean Up, ${d.ad}`}>
            <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <Metin tur="govdeKalin" numberOfLines={1}>{c.site_code}</Metin>
                <Metin tur="kucuk" renk={renk.metinIkincil}>{[c.bolge, p.toplam ? `${p.tamam}/${p.toplam} kalem tamam` : "kalem yok"].filter(Boolean).join(" · ")}</Metin>
              </View>
              <Rozet metin={d.ad} tonAdi={d.ton} />
            </View>
            {c.red_notu && c.onay_durum === "RED" ? <Metin tur="minik" renk={renk.hata} style={{ marginTop: 6 }} numberOfLines={2}>Red: {c.red_notu}</Metin> : null}
          </Kart>
        );
      })}
    </View>
  );
}

function IsKarti({ r, onPress }) {
  const d = durumBilgisi("is", r.durum);
  return (
    <Kart onPress={onPress} style={{ marginBottom: aralik.s }} erisimEtiketi={`${(r.site_codes || []).join(", ")}, ${r.kategori_ad || r.kategori}, ${d.ad}`}>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Metin tur="govdeKalin" numberOfLines={1}>{(r.site_codes || []).join(", ") || "Saha"}</Metin>
          <Metin tur="kucuk" renk={renk.metinIkincil}>{r.kategori_ad || r.kategori}</Metin>
        </View>
        <Rozet metin={d.ad} tonAdi={d.ton} />
      </View>
      {r.plan_tarihi || r.atayan_not ? (
        <Metin tur="minik" renk={renk.metinSoluk} style={{ marginTop: 6 }} numberOfLines={2}>
          {[r.plan_tarihi ? `Plan: ${tarih(r.plan_tarihi)}` : null, r.atayan_not].filter(Boolean).join(" · ")}
        </Metin>
      ) : null}
    </Kart>
  );
}

function MalzemeTaleplerim({ navigation }) {
  const { kullanici } = useOturum();
  const v = useVeri("malzemeTalepler", () => malzemeApi.taleplerim(kullanici));
  const rows = Array.isArray(v.veri) ? v.veri : [];
  return (
    <View>
      <Buton baslik="Yeni malzeme talebi" ikon="add" onPress={() => navigation.navigate("MalzemeTalep")} />
      <BolumBasligi baslik="Taleplerim" />
      {v.yukleniyor && !v.veri ? <><IskeletKart /><IskeletKart /></> : null}
      {v.hata && !v.veri ? <Kart><HataDurum hata={v.hata} onTekrar={v.yenile} /></Kart> : null}
      <EskiVeriBandi v={v} style={{ marginBottom: aralik.s }} />
      {v.veri && rows.length === 0 ? <Kart><BosDurum ikon="cube-outline" baslik="Henüz malzeme talebiniz yok" /></Kart> : null}
      {rows.map((t) => {
        const d = durumBilgisi("malzeme", t.durum);
        return (
          <Kart key={t.id} style={{ marginBottom: aralik.s }} onPress={() => navigation.navigate("MalzemeDetay", { talep: t })} erisimEtiketi={`${t.talep_no}, ${d.ad}`}>
            <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <Metin tur="govdeKalin">{t.talep_no || `#${t.id}`}</Metin>
                <Metin tur="kucuk" renk={renk.metinIkincil} numberOfLines={1}>{[t.site_id, t.bolge, t.proje, `${t.kalem_sayisi || 0} kalem`].filter(Boolean).join(" · ")}</Metin>
                <Metin tur="minik" renk={renk.metinSoluk}>{tarih(t.created_at)}</Metin>
              </View>
              <Rozet metin={d.ad} tonAdi={d.ton} />
            </View>
          </Kart>
        );
      })}
    </View>
  );
}

function Zimmetim() {
  const { kullanici } = useOturum();
  const gecersizKil = useGecersizKil();
  const v = useVeri("zimmet", () => malzemeApi.zimmetim(kullanici));
  const [iade, setIade] = useState(null); // { satir, miktar, not }
  const [bekle, setBekle] = useState(false);
  const rows = Array.isArray(v.veri) ? v.veri : [];
  const acik = rows.filter((r) => durumBilgisi("zimmet", r.durum).acik);
  const diger = rows.filter((r) => !durumBilgisi("zimmet", r.durum).acik);

  const iadeGonder = async () => {
    const m = Number(String(iade.miktar).replace(",", "."));
    if (!(m > 0) || m > Number(iade.satir.miktar)) { Alert.alert("Miktar hatalı", `0 ile ${iade.satir.miktar} arasında bir miktar girin.`); return; }
    setBekle(true);
    try {
      await malzemeApi.iade(iade.satir.id, { iade_miktar: m, notlar: iade.not.trim() });
      setIade(null);
      gecersizKil(["zimmet"]);
      Alert.alert("İade talebi gönderildi", "Depo sorumlusu onaylayınca malzeme üzerinizden düşer.");
    } catch (e) {
      Alert.alert("İade talebi gönderilemedi", hataMetni(e));
    } finally { setBekle(false); }
  };

  if (v.yukleniyor && !v.veri) return <><IskeletKart /><IskeletKart /></>;
  if (v.hata && !v.veri) return <Kart><HataDurum hata={v.hata} onTekrar={v.yenile} /></Kart>;
  return (
    <View>
      <EskiVeriBandi v={v} style={{ marginBottom: aralik.s }} />
      {acik.length === 0 ? <Kart><BosDurum ikon="briefcase-outline" baslik="Üzerinizde zimmetli malzeme yok" /></Kart> : acik.map((r) => (
        <Kart key={r.id} style={{ marginBottom: aralik.s }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              <Metin tur="govdeKalin">{r.malzeme_adi}</Metin>
              <Metin tur="kucuk" renk={renk.metinIkincil}>{`${r.miktar} ${r.birim || ""}`.trim()} · {[r.site_id, r.talep_no, tarih(r.verilme_tarihi)].filter(Boolean).join(" · ")}</Metin>
            </View>
            <Rozet metin={durumBilgisi("zimmet", r.durum).ad} tonAdi={durumBilgisi("zimmet", r.durum).ton} />
          </View>
          {iade?.satir.id === r.id ? (
            <View style={{ marginTop: aralik.m }}>
              <Alan etiket={`İade miktarı (en fazla ${r.miktar})`} deger={String(iade.miktar)} onDegis={(x) => setIade({ ...iade, miktar: x })} klavye="decimal-pad" />
              <Alan etiket="Not" deger={iade.not} onDegis={(x) => setIade({ ...iade, not: x })} ipucu="Örn. kullanılmadı, sahadan döndü" />
              <View style={{ flexDirection: "row", gap: aralik.s }}>
                <Buton baslik="Vazgeç" tur="ikincil" onPress={() => setIade(null)} style={{ flex: 1 }} kucuk />
                <Buton baslik="İade talebi gönder" onPress={iadeGonder} yukleniyor={bekle} style={{ flex: 1.4 }} kucuk />
              </View>
            </View>
          ) : r.durum === "PERSONELDE" ? (
            <Pressable onPress={() => setIade({ satir: r, miktar: r.miktar, not: "" })} accessibilityRole="button" style={{ marginTop: aralik.s }}>
              <Metin tur="kucukKalin" renk={renk.lacivertAcik}>Depoya iade et</Metin>
            </Pressable>
          ) : null}
        </Kart>
      ))}
      {diger.length ? (
        <>
          <BolumBasligi baslik="Geçmiş" />
          {diger.slice(0, 30).map((r) => (
            <Kart key={r.id} style={{ marginBottom: aralik.s }}>
              <Metin tur="kucukKalin">{r.malzeme_adi}</Metin>
              <Metin tur="minik" renk={renk.metinSoluk}>{`${r.iade_miktar || r.miktar} ${r.birim || ""}`} · {durumBilgisi("zimmet", r.durum).ad}</Metin>
            </Kart>
          ))}
        </>
      ) : null}
    </View>
  );
}
