// Dış taşeron firma deneyimi: Ana sayfa, Atanan İşler, Hakedişlerim, Faturalar ve Ödemeler, Belgeler.
// Tüm veri /taseron-panel/* uçlarından ve YALNIZ bağlı taşeronun kapsamından gelir (backend taseron_id ile doğrular).
// Taşeron fiyatı, merkez QC sonucunu ya da ödeme durumunu değiştiremez: ekranlar yalnız görüntüler.
// Para birimleri ayrı gösterilir; veri alınamazsa "0" ya da "iş yok" gösterilmez.
import React, { useCallback, useRef, useState } from "react";
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StatusBar, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { aralik, renk, yazi } from "../tema";
import { BilgiSatiri, BolumBasligi, Buton, Kart, Metin, Rozet, IkonKutu } from "../bilesenler/temel";
import { Bant, BosDurum, EskiVeriBandi, HataDurum, IskeletKart } from "../bilesenler/durum";
import { Ekran } from "../bilesenler/Ekran";
import { FirmaBasligi } from "../bilesenler/marka";
import { BaglantiBandi } from "../bilesenler/BaglantiBandi";
import { useOturum } from "../oturum/OturumSaglayici";
import { useGecersizKil, useVeri } from "../api/veri";
import { taseronPanelApi } from "../api/uclar";
import { durumBilgisi } from "../mantik/durumlar";
import { basHarfler, para, tarih } from "../mantik/bicim";
import { hataMetni } from "../mantik/hata";

const HAKEDIS_DURUM = {
  UYGUN: { ad: "QC uygun · hakedişe esas", ton: "basari" },
  QC_BEKLIYOR: { ad: "QC bekleniyor", ton: "uyari" },
  MIKTAR_BEKLIYOR: { ad: "Gerçekleşen miktar bekleniyor", ton: "notr" },
  FIYAT_YOK: { ad: "Fiyat belirlenmemiş", ton: "notr" },
  MUKERRER: { ad: "Mükerrer kayıt · toplama girmez", ton: "hata" },
};
const FATURA_DURUM = { ODENDI: { ad: "Ödendi", ton: "basari" }, KISMI: { ad: "Kısmi ödendi", ton: "uyari" }, BEKLIYOR: { ad: "Ödeme bekliyor", ton: "notr" } };

export function TaseronAnaSayfa({ navigation }) {
  const { kullanici } = useOturum();
  const kenar = useSafeAreaInsets();
  const profil = useVeri("taseronProfil", () => taseronPanelApi.profil());
  const ozet = useVeri("taseronOzet", () => taseronPanelApi.ozet());
  useFocusEffect(useCallback(() => { StatusBar.setBarStyle("light-content", true); }, []));
  const pr = profil.veri, o = ozet.veri;
  const firma = { ad: pr?.taseron?.ad || kullanici?.taseron?.ad || "Taşeron firma", kod: null, logo: null };
  const say = (n) => (n === null || n === undefined ? "—" : String(n));
  return (
    <View style={{ flex: 1, backgroundColor: renk.zemin }}>
      <ScrollView contentContainerStyle={{ paddingBottom: aralik.xxl }}
        refreshControl={<RefreshControl refreshing={ozet.yenileniyor} onRefresh={() => { ozet.yenile(); profil.yenile(); }} tintColor="#fff" />}>
        <View style={{ backgroundColor: renk.lacivert, paddingTop: kenar.top + aralik.xs, paddingHorizontal: aralik.m, paddingBottom: 64 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <FirmaBasligi firma={firma} alt={`Taşeron paneli · Omnix Platformu${pr?.ana_firma?.ad ? ` · ${pr.ana_firma.ad}` : ""}`} />
            <Pressable onPress={() => navigation.navigate("Profil")} accessibilityRole="button" accessibilityLabel="Profil ve çıkış"
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center", marginLeft: aralik.s }}>
              <Metin tur="kucukKalin" renk="#fff">{basHarfler(kullanici?.name)}</Metin>
            </Pressable>
          </View>
          <Metin tur="baslikXL" renk="#fff" style={{ marginTop: aralik.l }} numberOfLines={1}>Merhaba{kullanici?.name ? `, ${String(kullanici.name).split(" ")[0]}` : ""}</Metin>
          <Metin tur="kucuk" renk="#C7D3E3" numberOfLines={1}>{pr?.ana_firma?.ad ? `${pr.ana_firma.ad} kapsamında çalışıyorsunuz` : "Taşeron firma hesabı"}</Metin>
        </View>
        <BaglantiBandi />
        <View style={{ paddingHorizontal: aralik.m, marginTop: -48 }}>
          {ozet.yukleniyor && !o ? <IskeletKart yukseklik={160} /> : null}
          {ozet.hata && !o ? <Kart><HataDurum hata={ozet.hata} baslik="Özet alınamadı" onTekrar={ozet.yenile} /></Kart> : null}
          {o ? (
            <Kart>
              <Metin tur="etiket" renk={renk.metinIkincil} style={{ textTransform: "uppercase", letterSpacing: 0.6 }}>İş durumu</Metin>
              <EskiVeriBandi v={ozet} style={{ marginTop: aralik.xs }} />
              <View style={{ flexDirection: "row", marginTop: aralik.s }}>
                <Kutu deger={say(o.isler?.aktif)} etiket="Aktif iş" />
                <Kutu deger={say(o.isler?.tamamlanan)} etiket="Tamamlanan" />
                <Kutu deger={say(o.qc_bekleyen_satir)} etiket="QC bekleyen" renk={o.qc_bekleyen_satir ? renk.uyari : undefined} />
              </View>
            </Kart>
          ) : null}
          {o ? (
            <>
              <BolumBasligi baslik="Hakediş" eylem="Ayrıntı" onEylem={() => navigation.navigate("TaseronHakedis")} />
              {!(o.hakedis || []).length ? <Kart><BosDurum ikon="cash-outline" baslik="Tamamlanmış ve fiyatlı iş yok" aciklama="İşler tamamlanıp QC'den geçtikçe burada görünür." /></Kart>
                : o.hakedis.map((h) => (
                  <Kart key={h.para_birimi} style={{ marginBottom: aralik.xs, paddingVertical: aralik.xs }}>
                    <BilgiSatiri etiket="QC uygun hakediş" deger={para(h.uygun, h.para_birimi)} />
                    <BilgiSatiri etiket="QC bekleyen" deger={para(h.qc_bekleyen, h.para_birimi)} />
                    <BilgiSatiri etiket="Uygun, henüz faturalanmamış" deger={para(h.uygun_faturalanmayan, h.para_birimi)} son />
                  </Kart>
                ))}
              <BolumBasligi baslik="Faturalar ve ödemeler" eylem="Ayrıntı" onEylem={() => navigation.navigate("TaseronFaturalar")} />
              {!(o.faturalar || []).length ? <Kart><BosDurum ikon="document-text-outline" baslik="Kayıtlı fatura yok" /></Kart>
                : o.faturalar.map((f) => (
                  <Kart key={f.para_birimi} style={{ marginBottom: aralik.xs, paddingVertical: aralik.xs }}>
                    <BilgiSatiri etiket={`Faturalanan (${f.adet} fatura)`} deger={para(f.faturalanan, f.para_birimi)} />
                    <BilgiSatiri etiket="Ödenen" deger={para(f.odenen, f.para_birimi)} />
                    <BilgiSatiri etiket="Kalan" deger={para(f.kalan, f.para_birimi)} son />
                  </Kart>
                ))}
            </>
          ) : null}
          <BolumBasligi baslik="Hızlı erişim" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: aralik.s }}>
            {[["briefcase-outline", "Atanan işler", "TaseronIsler"], ["cash-outline", "Hakedişlerim", "TaseronHakedis"],
              ["receipt-outline", "Faturalar", "TaseronFaturalar"], ["folder-open-outline", "Belgeler", "TaseronBelgeler"]].map(([ikon, ad, ekran]) => (
              <Kart key={ekran} onPress={() => navigation.navigate(ekran)} style={{ width: "48.5%", flexGrow: 1, flexBasis: "45%" }} erisimEtiketi={ad}>
                <IkonKutu ad={ikon} />
                <Metin tur="govdeKalin" style={{ marginTop: aralik.s }}>{ad}</Metin>
              </Kart>
            ))}
          </View>
        </View>
      </ScrollView>
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: kenar.top, backgroundColor: renk.lacivert }} />
    </View>
  );
}

function Kutu({ deger, etiket, renk: r }) {
  return (
    <View style={{ flex: 1, alignItems: "center" }} accessible accessibilityLabel={`${etiket}: ${deger}`}>
      <Metin tur="baslikL" renk={r || renk.metin} style={yazi.tutar}>{deger}</Metin>
      <Metin tur="minik" renk={renk.metinIkincil}>{etiket}</Metin>
    </View>
  );
}

// ── Atanan işler ──────────────────────────────────────────────────────────────────────────────
export function TaseronIslerEkrani({ navigation }) {
  const v = useVeri("taseronIsler", async () => (await taseronPanelApi.isler()).rows || []);
  const rows = Array.isArray(v.veri) ? v.veri : [];
  const acik = rows.filter((r) => !["TAMAMLANDI", "IPTAL"].includes(r.durum));
  const kapali = rows.filter((r) => ["TAMAMLANDI", "IPTAL"].includes(r.durum));
  return (
    <Ekran baslik="Atanan işler" geri={false} yenileniyor={v.yenileniyor} onYenile={v.yenile}>
      {v.yukleniyor && !v.veri ? <><IskeletKart /><IskeletKart /></> : null}
      {v.hata && !v.veri ? <Kart><HataDurum hata={v.hata} baslik="İşler alınamadı" onTekrar={v.yenile} /></Kart> : null}
      <EskiVeriBandi v={v} style={{ marginBottom: aralik.s }} />
      {v.veri && !rows.length ? <Kart><BosDurum ikon="briefcase-outline" baslik="Size atanmış iş yok" aciklama="Atama yapıldığında burada görünür." /></Kart> : null}
      {acik.map((r) => <IsKarti key={r.id} r={r} onPress={() => navigation.navigate("TaseronIsDetay", { is: r })} />)}
      {kapali.length ? <BolumBasligi baslik="Tamamlanan / iptal" /> : null}
      {kapali.slice(0, 30).map((r) => <IsKarti key={r.id} r={r} onPress={() => navigation.navigate("TaseronIsDetay", { is: r })} />)}
    </Ekran>
  );
}

function IsKarti({ r, onPress }) {
  const d = durumBilgisi("is", r.durum);
  return (
    <Kart onPress={onPress} style={{ marginBottom: aralik.s }} erisimEtiketi={`${(r.site_codes || []).join(", ")}, ${r.kategori_ad || r.kategori}, ${d.ad}`}>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Metin tur="govdeKalin" numberOfLines={1}>{(r.site_codes || []).join(", ")}</Metin>
          <Metin tur="kucuk" renk={renk.metinIkincil}>{[r.kategori_ad || r.kategori, r.bolge].filter(Boolean).join(" · ")}</Metin>
        </View>
        <Rozet metin={d.ad} tonAdi={d.ton} />
      </View>
      <Metin tur="kucukKalin" style={{ marginTop: 6 }}>
        {r.fiyat ? `${para(r.fiyat.toplam, r.fiyat.para_birimi)} ${r.fiyat.kdv_esasi === "HARIC" ? "+ KDV" : "(KDV dahil)"}` : "Fiyat henüz belirlenmedi"}
      </Metin>
      {r.plan_tarihi ? <Metin tur="minik" renk={renk.metinSoluk}>Plan: {tarih(r.plan_tarihi)}</Metin> : null}
    </Kart>
  );
}

export function TaseronIsDetayEkrani({ route }) {
  const ilk = route.params.is;
  const gecersizKil = useGecersizKil();
  const v = useVeri(`taseronIs:${ilk.id}`, async () => (await taseronPanelApi.is(ilk.id)).row);
  const a = v.veri || ilk;
  const d = durumBilgisi("is", a.durum);
  const [bekle, setBekle] = useState(false);
  const kilit = useRef(false);
  const islem = async (is, mesaj) => {
    if (kilit.current) return;
    kilit.current = true; setBekle(true);
    try { await is(); gecersizKil([`taseronIs:${ilk.id}`, "taseronIsler", "taseronOzet"]); Alert.alert(mesaj); }
    catch (e) { gecersizKil([`taseronIs:${ilk.id}`]); Alert.alert("İşlem tamamlanamadı", e?.sonucBelirsiz ? "Bağlantı koptu. Durum yenilendi; gerekiyorsa tekrar deneyin." : hataMetni(e)); }
    finally { kilit.current = false; setBekle(false); }
  };
  const belgeAc = async (b) => {
    try {
      const r = await taseronPanelApi.belgeAdresi(a.id, b);
      await Linking.openURL(r.url);
    } catch (e) { Alert.alert("Belge açılamadı", hataMetni(e)); }
  };
  const acik = !["TAMAMLANDI", "IPTAL"].includes(a.durum);
  const alt = acik ? (a.durum === "BASLADI"
    ? <Buton baslik="İş tamamlandı olarak bildir" ikon="checkmark-done" tur="basari" yukleniyor={bekle} onPress={() => Alert.alert("İş tamamlandı mı?", "Tamamlanma bildirimi merkeze iletilir. QC ve hakediş merkezde değerlendirilir.", [
        { text: "Vazgeç", style: "cancel" }, { text: "Bildir", onPress: () => islem(() => taseronPanelApi.bitir(a.id), "Tamamlanma bildirildi") }])} />
    : <Buton baslik="İşe başladık" ikon="play" yukleniyor={bekle} onPress={() => islem(() => taseronPanelApi.basla(a.id), "Başlangıç kaydedildi")} />) : null;
  return (
    <Ekran baslik={(a.site_codes || []).join(", ")} altBaslik={a.kategori_ad || a.kategori} yenileniyor={v.yenileniyor} onYenile={v.yenile} alt={alt}>
      {v.hata && !v.veri ? <Kart><HataDurum hata={v.hata} onTekrar={v.yenile} /></Kart> : null}
      <EskiVeriBandi v={v} style={{ marginBottom: aralik.s }} />
      <Kart>
        <Rozet metin={d.ad} tonAdi={d.ton} />
        <View style={{ marginTop: aralik.s }}>
          <BilgiSatiri etiket="Bölge" deger={a.bolge} />
          <BilgiSatiri etiket="Plan tarihi" deger={tarih(a.plan_tarihi)} />
          <BilgiSatiri etiket="Başlama" deger={tarih(a.baslama_ts)} />
          <BilgiSatiri etiket="Tamamlanma" deger={tarih(a.bitis_ts)} son />
        </View>
        {a.atayan_not ? <Bant tonAdi="bilgi" baslik="Açıklama" metin={a.atayan_not} style={{ marginTop: aralik.s }} /> : null}
      </Kart>

      <BolumBasligi baslik="Kapsam ve anlaşılmış fiyat" />
      {!a.fiyat ? <Bant tonAdi="notr" metin="Bu işin fiyatı henüz belirlenmedi. Fiyat girildiğinde burada görünür." /> : (
        <Kart style={{ paddingVertical: aralik.xs }}>
          {a.fiyat.kalemler.map((k, i) => (
            <BilgiSatiri key={i} etiket={`${k.aciklama}${k.kalem_kodu ? ` (${k.kalem_kodu})` : ""} · ${k.miktar} ${k.birim} × ${para(k.birim_fiyat, a.fiyat.para_birimi)}`} deger={para(k.tutar, a.fiyat.para_birimi)} />
          ))}
          <BilgiSatiri etiket={`Toplam ${a.fiyat.kdv_esasi === "HARIC" ? "(KDV hariç)" : "(KDV dahil)"}`} deger={para(a.fiyat.toplam, a.fiyat.para_birimi)} son />
          {(a.fiyat_gecmisi || []).length > 1 ? (
            <Metin tur="minik" renk={renk.metinSoluk} style={{ paddingVertical: aralik.xs }}>
              Fiyat revizyonları: {a.fiyat_gecmisi.map((g) => `${g.surum}. sürüm ${tarih(g.tarih)}${g.neden ? ` (${g.neden})` : ""}`).join(" · ")}
            </Metin>
          ) : null}
        </Kart>
      )}

      {(a.sahalar || []).length ? (
        <>
          <BolumBasligi baslik="Saha" />
          <Kart style={{ paddingVertical: aralik.xs }}>
            {a.sahalar.map((s, i) => <BilgiSatiri key={s.site_code} etiket={s.site_code} deger={[s.proje, s.saha_tipi, s.qc_durum ? `Saha QC ${s.qc_durum}` : null].filter(Boolean).join(" · ") || "—"} son={i === a.sahalar.length - 1} />)}
          </Kart>
        </>
      ) : null}

      <BolumBasligi baslik="Belgeler" />
      {!(a.belgeler || []).length ? <Kart><Metin tur="kucuk" renk={renk.metinSoluk}>Bu iş için yüklenmiş teknik belge yok.</Metin></Kart> : (
        <Kart style={{ paddingVertical: aralik.xs }}>
          {a.belgeler.map((b, i) => (
            <Pressable key={`${b.site_code}-${b.alan}-${b.sira}`} onPress={() => belgeAc(b)} accessibilityRole="link" style={{ flexDirection: "row", alignItems: "center", minHeight: 48, borderBottomWidth: i === a.belgeler.length - 1 ? 0 : 0.5, borderBottomColor: renk.cizgi }}>
              <Ionicons name="document-text-outline" size={20} color={renk.lacivert} />
              <Metin tur="govde" style={{ flex: 1, marginLeft: aralik.xs }}>{b.etiket}{b.sira ? ` (${b.sira + 1})` : ""} · {b.site_code}</Metin>
              <Ionicons name="open-outline" size={18} color={renk.metinSoluk} />
            </Pressable>
          ))}
        </Kart>
      )}
    </Ekran>
  );
}

// ── Hakedişlerim ─────────────────────────────────────────────────────────────────────────────
export function TaseronHakedisEkrani() {
  const v = useVeri("taseronHakedis", () => taseronPanelApi.hakedis());
  const [acik, setAcik] = useState(null);
  const h = v.veri;
  return (
    <Ekran baslik="Hakedişlerim" geri={false} yenileniyor={v.yenileniyor} onYenile={v.yenile}>
      {v.yukleniyor && !h ? <><IskeletKart /><IskeletKart /></> : null}
      {v.hata && !h ? <Kart><HataDurum hata={v.hata} baslik="Hakediş bilgisi alınamadı" onTekrar={v.yenile} /></Kart> : null}
      <EskiVeriBandi v={v} style={{ marginBottom: aralik.s }} />
      {h ? (
        <>
          <Bant tonAdi="bilgi" metin="Bedel = anlaşılan birim fiyat × hakedişe esas miktar. Yalnız merkez QC'si uygun olan kalemler faturalanabilir sayılır." style={{ marginBottom: aralik.s }} />
          {(h.toplamlar || []).map((t) => (
            <Kart key={t.para_birimi} style={{ marginBottom: aralik.s, paddingVertical: aralik.xs }}>
              <Metin tur="etiket" renk={renk.metinIkincil} style={{ paddingTop: aralik.xs }}>{t.para_birimi}</Metin>
              <BilgiSatiri etiket="Tamamlanan işlerin bedeli" deger={para(t.tamamlanan, t.para_birimi)} />
              <BilgiSatiri etiket="QC bekleyen / düzeltme gereken" deger={para(t.qc_bekleyen, t.para_birimi)} />
              <BilgiSatiri etiket="Hakedişe / faturaya uygun" deger={para(t.uygun, t.para_birimi)} />
              <BilgiSatiri etiket="Uygun · faturalanmış" deger={para(t.uygun_faturalanan, t.para_birimi)} />
              <BilgiSatiri etiket="Uygun · henüz faturalanmamış" deger={para(t.uygun_faturalanmayan, t.para_birimi)} son />
            </Kart>
          ))}
          {!(h.satirlar || []).length ? <Kart><BosDurum ikon="cash-outline" baslik="Tamamlanmış iş yok" aciklama="Atanan işleriniz tamamlandıkça burada listelenir." /></Kart> : null}
          {(h.satirlar || []).map((s, i) => {
            const d = HAKEDIS_DURUM[s.durum] || { ad: s.durum, ton: "notr" };
            const k = `${s.is_id}-${i}`;
            return (
              <Kart key={k} style={{ marginBottom: aralik.xs }} onPress={() => setAcik(acik === k ? null : k)} erisimEtiketi={`${s.site_code} ${s.kalem || s.kapsam}, ${d.ad}`}>
                <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                  <View style={{ flex: 1 }}>
                    <Metin tur="govdeKalin">{s.site_code}</Metin>
                    <Metin tur="kucuk" renk={renk.metinIkincil} numberOfLines={2}>{[s.kalem || s.kapsam, s.tamamlanma ? `tamamlandı ${tarih(s.tamamlanma)}` : null].filter(Boolean).join(" · ")}</Metin>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Metin tur="kucukKalin" style={yazi.tutar}>{s.tutar === null ? "—" : para(s.tutar, s.para_birimi)}</Metin>
                    <Rozet metin={d.ad} tonAdi={d.ton} style={{ marginTop: 4 }} />
                  </View>
                </View>
                {acik === k ? (
                  <View style={{ marginTop: aralik.s }}>
                    <BilgiSatiri etiket="Hesap" deger={s.hesap || s.aciklama} />
                    <BilgiSatiri etiket="Anlaşılan" deger={s.anlasilan_miktar ? `${s.anlasilan_miktar} ${s.birim || ""} × ${para(s.birim_fiyat, s.para_birimi)}` : null} />
                    <BilgiSatiri etiket="QC" deger={s.qc === "OK" ? "Uygun" : s.qc ? "Bekleniyor" : null} />
                    <BilgiSatiri etiket="KDV" deger={s.kdv_esasi === "HARIC" ? "Hariç" : s.kdv_esasi === "DAHIL" ? "Dahil" : null} />
                    <BilgiSatiri etiket="Fatura" deger={s.faturalandi ? "Faturalanmış" : "Henüz faturalanmamış"} son />
                  </View>
                ) : null}
              </Kart>
            );
          })}
        </>
      ) : null}
    </Ekran>
  );
}

// ── Faturalar ve ödemeler ───────────────────────────────────────────────────────────────────────
export function TaseronFaturalarEkrani({ navigation }) {
  const v = useVeri("taseronFaturalar", async () => (await taseronPanelApi.faturalar()).rows || []);
  const rows = Array.isArray(v.veri) ? v.veri : [];
  return (
    <Ekran baslik="Faturalar ve ödemeler" geri={false} yenileniyor={v.yenileniyor} onYenile={v.yenile}>
      {v.yukleniyor && !v.veri ? <><IskeletKart /><IskeletKart /></> : null}
      {v.hata && !v.veri ? <Kart><HataDurum hata={v.hata} baslik="Faturalar alınamadı" onTekrar={v.yenile} /></Kart> : null}
      <EskiVeriBandi v={v} style={{ marginBottom: aralik.s }} />
      {v.veri && !rows.length ? <Kart><BosDurum ikon="receipt-outline" baslik="Kayıtlı fatura yok" aciklama="Faturalarınız merkeze işlendiğinde burada görünür." /></Kart> : null}
      {rows.map((f) => {
        const d = FATURA_DURUM[f.durum] || { ad: f.durum, ton: "notr" };
        return (
          <Kart key={f.id} style={{ marginBottom: aralik.s }} onPress={() => navigation.navigate("TaseronFaturaDetay", { fatura: f })} erisimEtiketi={`Fatura ${f.fatura_no}, ${d.ad}`}>
            <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <Metin tur="govdeKalin">{f.fatura_no || `#${f.id}`}</Metin>
                <Metin tur="kucuk" renk={renk.metinIkincil}>{tarih(f.fatura_tarihi)}</Metin>
              </View>
              <Rozet metin={d.ad} tonAdi={d.ton} />
            </View>
            <View style={{ flexDirection: "row", marginTop: aralik.xs }}>
              <Metin tur="kucuk" style={{ flex: 1 }}>Toplam <Metin tur="kucukKalin">{para(f.toplam_tutar, f.para_birimi)}</Metin></Metin>
              <Metin tur="kucuk">Kalan <Metin tur="kucukKalin" renk={f.kalan_borc > 0 ? renk.uyari : renk.basari}>{para(f.kalan_borc, f.para_birimi)}</Metin></Metin>
            </View>
          </Kart>
        );
      })}
    </Ekran>
  );
}

export function TaseronFaturaDetayEkrani({ route }) {
  const ilk = route.params.fatura;
  const v = useVeri(`taseronFatura:${ilk.id}`, () => taseronPanelApi.fatura(ilk.id));
  const f = v.veri?.fatura || ilk;
  const d = FATURA_DURUM[f.durum] || { ad: f.durum, ton: "notr" };
  return (
    <Ekran baslik={`Fatura ${f.fatura_no || ""}`} altBaslik={tarih(f.fatura_tarihi)} yenileniyor={v.yenileniyor} onYenile={v.yenile}>
      {v.hata && !v.veri ? <Kart><HataDurum hata={v.hata} onTekrar={v.yenile} /></Kart> : null}
      <EskiVeriBandi v={v} style={{ marginBottom: aralik.s }} />
      <Kart style={{ paddingVertical: aralik.xs }}>
        <View style={{ paddingVertical: aralik.xs }}><Rozet metin={d.ad} tonAdi={d.ton} /></View>
        <BilgiSatiri etiket="Toplam" deger={para(f.toplam_tutar, f.para_birimi)} />
        <BilgiSatiri etiket="Ödenen" deger={para(f.odenen_tutar, f.para_birimi)} />
        <BilgiSatiri etiket="Kalan" deger={para(f.kalan_borc, f.para_birimi)} />
        <BilgiSatiri etiket="Para birimi" deger={f.para_birimi} son />
      </Kart>
      {v.veri ? (
        <>
          <BolumBasligi baslik="Bağlı sahalar" />
          {v.veri.saha_baglantisi_eksik ? <Bant tonAdi="uyari" metin="Saha bağlantısı eksik. Bu fatura henüz sahalarla eşleştirilmedi; tahmini bağlantı gösterilmez." /> : (
            <Kart style={{ paddingVertical: aralik.xs }}>
              {v.veri.sahalar.map((s, i) => <BilgiSatiri key={i} etiket={`${s.site_code} · ${s.kalem_adi}${s.miktar ? ` · ${s.miktar} ${s.birim || ""}` : ""}`} deger={s.tutar === null ? "—" : para(s.tutar, f.para_birimi)} son={i === v.veri.sahalar.length - 1} />)}
            </Kart>
          )}
          <BolumBasligi baslik="Ödemeler" />
          {!v.veri.odemeler.length ? <Kart><Metin tur="kucuk" renk={renk.metinSoluk}>Bu faturaya kayıtlı ödeme yok.</Metin></Kart> : (
            <Kart style={{ paddingVertical: aralik.xs }}>
              {v.veri.odemeler.map((o, i) => <BilgiSatiri key={i} etiket={`${tarih(o.tarih)} · ${o.referans}`} deger={para(o.tutar, f.para_birimi)} son={i === v.veri.odemeler.length - 1} />)}
            </Kart>
          )}
        </>
      ) : null}
    </Ekran>
  );
}

// ── Belgeler ─────────────────────────────────────────────────────────────────────────────────
export function TaseronBelgelerEkrani() {
  const v = useVeri("taseronBelgeler", async () => (await taseronPanelApi.belgeler()).rows || []);
  const rows = Array.isArray(v.veri) ? v.veri : [];
  const ac = async (b) => {
    try { const r = await taseronPanelApi.belgeAdresi(b.is_id, b); await Linking.openURL(r.url); }
    catch (e) { Alert.alert("Belge açılamadı", hataMetni(e)); }
  };
  return (
    <Ekran baslik="Belgeler" altBaslik="İşlerinize ait teknik saha belgeleri" yenileniyor={v.yenileniyor} onYenile={v.yenile}>
      {v.yukleniyor && !v.veri ? <><IskeletKart /><IskeletKart /></> : null}
      {v.hata && !v.veri ? <Kart><HataDurum hata={v.hata} baslik="Belgeler alınamadı" onTekrar={v.yenile} /></Kart> : null}
      <EskiVeriBandi v={v} style={{ marginBottom: aralik.s }} />
      {v.veri && !rows.length ? <Kart><BosDurum ikon="folder-open-outline" baslik="Belge yok" aciklama="İşlerinize TSSR, proje ya da çizim yüklendiğinde burada görünür." /></Kart> : null}
      {rows.length ? (
        <Kart style={{ paddingVertical: aralik.xs }}>
          {rows.map((b, i) => (
            <Pressable key={`${b.is_id}-${b.site_code}-${b.alan}-${b.sira}`} onPress={() => ac(b)} accessibilityRole="link"
              style={{ flexDirection: "row", alignItems: "center", minHeight: 52, borderBottomWidth: i === rows.length - 1 ? 0 : 0.5, borderBottomColor: renk.cizgi }}>
              <Ionicons name="document-text-outline" size={20} color={renk.lacivert} />
              <View style={{ flex: 1, marginLeft: aralik.xs }}>
                <Metin tur="govde">{b.etiket}{b.sira ? ` (${b.sira + 1})` : ""}</Metin>
                <Metin tur="minik" renk={renk.metinSoluk}>{b.site_code} · {b.kapsam || "İş"}</Metin>
              </View>
              <Ionicons name="open-outline" size={18} color={renk.metinSoluk} />
            </Pressable>
          ))}
        </Kart>
      ) : null}
    </Ekran>
  );
}

// Taşeron hesabı ama bağlantısı eksik / eski tip: veri gösterilmez, yöneticiye yönlendirilir
export function TaseronBaglantiYokEkrani({ navigation }) {
  const { kullanici } = useOturum();
  return (
    <Ekran baslik="Taşeron paneli" geri={false}>
      <Kart>
        <BosDurum ikon="link-outline" baslik="Hesabınız bir taşeron firmaya bağlanmamış"
          aciklama="Güvenlik gereği bağlantısı tamamlanmamış hesapta iş, fiyat ve fatura bilgisi gösterilmez. Lütfen ana firmadaki yöneticinizden hesabınızı taşeron kaydınıza bağlamasını isteyin." />
        <Metin tur="minik" renk={renk.metinSoluk} style={{ textAlign: "center" }}>{kullanici?.email}</Metin>
        <Buton baslik="Profil ve çıkış" tur="ikincil" onPress={() => navigation.navigate("Profil")} style={{ marginTop: aralik.m }} />
      </Kart>
    </Ekran>
  );
}
