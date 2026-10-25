// Rollout işi: saha belgeleri, İşe Başla ve Çıkış (tamamlandı mı / QC / ara verme sebebi / bugün çalışanlar / not).
// Yetki backend'de: işe atanan personelden herhangi biri başlatıp kapatabilir.
import React, { useRef, useState } from "react";
import { Alert, Linking, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { aralik, kose, renk } from "../tema";
import { BilgiSatiri, BolumBasligi, Buton, Kart, Metin, Rozet } from "../bilesenler/temel";
import { Bant, HataDurum } from "../bilesenler/durum";
import { Alan, CipSecim } from "../bilesenler/form";
import { Ekran } from "../bilesenler/Ekran";
import { useOturum } from "../oturum/OturumSaglayici";
import { useGecersizKil, useVeri } from "../api/veri";
import { isApi } from "../api/uclar";
import { durumBilgisi } from "../mantik/durumlar";
import { saat, tarih } from "../mantik/bicim";
import { hataMetni } from "../mantik/hata";
import { IS_DURDURMA_SEBEPLERI } from "../mantik/sabitler";

export function IsDetayEkrani({ route, navigation }) {
  const ilk = route.params.is;
  const { kullanici } = useOturum();
  const gecersizKil = useGecersizKil();
  const v = useVeri(`is:${ilk.id}`, async () => (await isApi.detay(ilk.id)).row);
  const s = v.veri || ilk;
  const d = durumBilgisi("is", s.durum);
  const acik = !["TAMAMLANDI", "IPTAL"].includes(s.durum);
  const [cikis, setCikis] = useState(null);
  const [bekle, setBekle] = useState(false);
  const kilit = useRef(false);

  const islem = async (is, basari) => {
    if (kilit.current) return;
    kilit.current = true;
    setBekle(true);
    try {
      await is();
      gecersizKil([`is:${ilk.id}`, "isler"]);
      if (basari) Alert.alert(basari[0], basari[1]);
      return true;
    } catch (e) {
      // Bağlantı koparsa güncel durumu oku: işlem sunucuda gerçekleştiyse ikinci kez yapılmaz
      gecersizKil([`is:${ilk.id}`, "isler"]);
      Alert.alert("İşlem tamamlanamadı", e?.sonucBelirsiz ? "Bağlantı koptu. Güncel durum yenilendi; gerekiyorsa tekrar deneyin." : hataMetni(e));
      return false;
    } finally { kilit.current = false; setBekle(false); }
  };

  const basla = () => Alert.alert("İşe başla", `${(s.site_codes || []).join(", ")}\n${s.kategori_ad || s.kategori}\n\nBaşlama saati kaydedilecek.`, [
    { text: "Vazgeç", style: "cancel" },
    { text: "Başla", onPress: () => islem(() => isApi.basla(s.id)) },
  ]);

  const cikisGonder = async () => {
    const c = cikis;
    if (c.tamamlandi === null) return Alert.alert("Eksik bilgi", "Saha tamamlandı mı, devam mı ediyor?");
    if (c.tamamlandi && s.qc_yazar && c.qc === null) return Alert.alert("Eksik bilgi", "QC tamamlandı mı?");
    if (c.tamamlandi && s.qc_yazar && c.qc === false && !c.not.trim()) return Alert.alert("Not gerekli", "QC tamamlanmadıysa kısa bir not yazın.");
    if (!c.tamamlandi && c.sebep !== "Yarın devam" && !c.not.trim()) return Alert.alert("Not gerekli", `"${c.sebep}" için kısa bir açıklama yazın.`);
    const ok = await islem(() => isApi.bitir(s.id, {
      tamamlandi: c.tamamlandi, qc_tamamlandi: s.qc_yazar ? c.qc : null, not: c.not.trim() || null,
      sebep: c.tamamlandi ? null : c.sebep, calisanlar: (s.personeller || []).filter((p) => c.calisanlar.includes(p.email)),
    }), c.tamamlandi ? ["Kaydedildi", "İş kapatıldı; rollout verisi güncellendi."] : ["Gün kapatıldı", "Devam etmek için tekrar 'İşe başla'ya dokunun."]);
    if (ok) setCikis(null);
  };

  const benAtandim = (s.personeller || []).some((p) => String(p.email).toLowerCase() === String(kullanici.email).toLowerCase());

  return (
    <Ekran baslik={(s.site_codes || []).join(", ") || "İş"} altBaslik={s.kategori_ad || s.kategori} yenileniyor={v.yenileniyor} onYenile={v.yenile} klavye
      alt={acik && !cikis ? (s.durum === "BASLADI"
        ? <Buton baslik="Çıkış yap / günü kapat" ikon="log-out-outline" onPress={() => setCikis({ tamamlandi: null, qc: null, sebep: "Yarın devam", not: "", calisanlar: (s.personeller || []).map((p) => p.email) })} />
        : <Buton baslik="İşe başla" ikon="play" tur="basari" onPress={basla} yukleniyor={bekle} devreDisi={!benAtandim} />) : null}>
      {v.hata && !v.veri ? <HataDurum hata={v.hata} onTekrar={v.yenile} /> : null}
      <Kart>
        <Rozet metin={d.ad} tonAdi={d.ton} />
        <View style={{ marginTop: aralik.s }}>
          <BilgiSatiri etiket="Plan tarihi" deger={tarih(s.plan_tarihi)} />
          <BilgiSatiri etiket="Atayan" deger={s.atayan_ad} />
          <BilgiSatiri etiket="Başlama" deger={s.baslama_ts ? `${tarih(s.baslama_ts)} ${saat(s.baslama_ts)}` : null} />
          <BilgiSatiri etiket="Ekip" deger={(s.personeller || []).map((p) => p.ad || p.email).join(", ")} son />
        </View>
        {s.atayan_not ? <Bant tonAdi="bilgi" baslik="Atayanın notu" metin={s.atayan_not} style={{ marginTop: aralik.s }} /> : null}
        {!benAtandim && acik ? <Bant tonAdi="uyari" metin="Bu işe atanmış görünmüyorsunuz; başlatma ve kapatma atanan ekip tarafından yapılır." style={{ marginTop: aralik.s }} /> : null}
      </Kart>

      {s.kategori === "CLEANUP" ? (
        <>
          <BolumBasligi baslik="Clean Up fotoğrafları" />
          {(s.site_codes || []).map((kod) => (
            <Buton key={kod} baslik={`${kod} · eksikler ve fotoğraflar`} ikon="camera-outline" tur="ikincil" onPress={() => navigation.navigate("Cleanup", { site: kod })} style={{ marginBottom: aralik.xs }} />
          ))}
        </>
      ) : null}

      {cikis ? (
        <Kart style={{ marginTop: aralik.s }}>
          <Metin tur="baslikM" style={{ fontWeight: "700", marginBottom: aralik.s }}>Çıkış</Metin>
          <CipSecim etiket="Saha durumu" zorunlu deger={cikis.tamamlandi === null ? null : cikis.tamamlandi ? "evet" : "hayir"}
            secenekler={[{ id: "evet", ad: "Tamamlandı" }, { id: "hayir", ad: "Devam ediyor" }]} onSec={(x) => setCikis({ ...cikis, tamamlandi: x === "evet" })} />
          {cikis.tamamlandi && s.qc_yazar ? (
            <CipSecim etiket="QC tamamlandı mı?" zorunlu deger={cikis.qc === null ? null : cikis.qc ? "evet" : "hayir"}
              secenekler={[{ id: "evet", ad: "Evet" }, { id: "hayir", ad: "Hayır" }]} onSec={(x) => setCikis({ ...cikis, qc: x === "evet" })} />
          ) : null}
          {cikis.tamamlandi === false ? (
            <CipSecim etiket="Neden devam ediyor?" secenekler={IS_DURDURMA_SEBEPLERI} deger={cikis.sebep} onSec={(x) => setCikis({ ...cikis, sebep: x })} />
          ) : null}
          {(s.personeller || []).length > 1 ? (
            <>
              <Metin tur="etiket" renk={renk.metinIkincil} style={{ marginBottom: 6 }}>Bugün çalışanlar</Metin>
              {(s.personeller || []).map((p) => {
                const sec = cikis.calisanlar.includes(p.email);
                return (
                  <Pressable key={p.email} onPress={() => setCikis({ ...cikis, calisanlar: sec ? cikis.calisanlar.filter((x) => x !== p.email) : [...cikis.calisanlar, p.email] })}
                    accessibilityRole="checkbox" accessibilityState={{ checked: sec }} style={{ flexDirection: "row", alignItems: "center", minHeight: 44 }}>
                    <Ionicons name={sec ? "checkbox" : "square-outline"} size={22} color={renk.lacivert} />
                    <Metin tur="govde" style={{ marginLeft: aralik.xs }}>{p.ad || p.email}</Metin>
                  </Pressable>
                );
              })}
            </>
          ) : null}
          <Alan etiket="Not" cokSatir deger={cikis.not} onDegis={(x) => setCikis({ ...cikis, not: x })} ipucu="Ofise ve Rollout Data'ya işlenir" style={{ marginTop: aralik.s }} />
          <View style={{ flexDirection: "row", gap: aralik.s }}>
            <Buton baslik="Vazgeç" tur="ikincil" onPress={() => setCikis(null)} style={{ flex: 1 }} />
            <Buton baslik="Kaydet" onPress={cikisGonder} yukleniyor={bekle} style={{ flex: 1.4 }} />
          </View>
        </Kart>
      ) : null}

      {(s.sahalar || []).filter((sa) => sa.site_type || sa.project_code || sa.qc_durum || sa.general_note || (sa.belgeler || []).length).map((sa) => (
        <View key={sa.site_code}>
          <BolumBasligi baslik={`${sa.site_code}${sa.il ? ` · ${sa.il}` : ""}`} />
          <Kart style={{ paddingVertical: aralik.xs }}>
            <BilgiSatiri etiket="Saha tipi" deger={sa.site_type} />
            <BilgiSatiri etiket="Proje" deger={sa.project_code} />
            <BilgiSatiri etiket="QC" deger={sa.qc_durum} />
            <BilgiSatiri etiket="Saha notu" deger={sa.general_note} son={!(sa.belgeler || []).length} />
            {(sa.belgeler || []).length ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: aralik.xs, paddingVertical: aralik.s }}>
                {sa.belgeler.map((b) => (
                  <Pressable key={b.url} onPress={() => Linking.openURL(b.url).catch(() => Alert.alert("Belge açılamadı"))} accessibilityRole="link"
                    style={{ flexDirection: "row", alignItems: "center", borderRadius: kose.tam, borderWidth: 1, borderColor: renk.cizgiKoyu, paddingHorizontal: 12, minHeight: 36 }}>
                    <Ionicons name="document-text-outline" size={16} color={renk.lacivert} />
                    <Metin tur="kucukKalin" style={{ marginLeft: 6 }}>{b.etiket}</Metin>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </Kart>
        </View>
      ))}

      {(s.gunler || []).length ? (
        <>
          <BolumBasligi baslik="Çalışma kayıtları" />
          <Kart style={{ paddingVertical: aralik.xs }}>
            {s.gunler.map((g, i) => (
              <BilgiSatiri key={g.id || i} etiket={`${tarih(g.tarih)} · ${g.personel_ad || g.personel_email}`}
                deger={`${saat(g.baslama) || "—"} – ${saat(g.bitis) || "devam"}`} son={i === s.gunler.length - 1} />
            ))}
          </Kart>
        </>
      ) : null}
    </Ekran>
  );
}
