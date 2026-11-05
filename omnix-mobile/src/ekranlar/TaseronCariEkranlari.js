// Taşeron firma sorumlusu (05.11.2026, Orhan — TEKNO_EMRAH):
//   • Hakediş ve Cari: yapılan iş bedeli, ödemeler, açık avans, net cari + Hakedişler / Ödemeler / Cari hareketler / Faturalar.
//     Tüm tutarlar /taseron-panel/cari'den — yönetimin cari ekranıyla aynı motor; burada hiçbir bakiye hesaplanmaz.
//   • Yaptığımız Sahalar: firmanın bugüne kadar montaj yaptığı / katıldığı işler, QC durumu ayrı (/taseron-saha/gecmis).
// Boş kayıt, erişim reddi ve servis hatası ayrı gösterilir; hata durumunda sıfır bakiye YAZILMAZ.
import React, { useEffect, useMemo, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { aralik, kose, renk, yazi } from "../tema";
import { BilgiSatiri, Kart, Metin, Rozet } from "../bilesenler/temel";
import { Bant, BosDurum, EskiVeriBandi, HataDurum, IskeletKart } from "../bilesenler/durum";
import { Ekran } from "../bilesenler/Ekran";
import { useVeri } from "../api/veri";
import { taseronPanelApi, taseronSahaApi } from "../api/uclar";
import { CARI_SEKMELER, FIYAT_TON, ODEME_TON, YON_TON, cariKartlari, hakedisArama } from "../mantik/taseronCari";
import { GECMIS_FILTRELER, GECMIS_SINIF, MONTAJ_TON, QC_TON, bolgeler as bolgeListesi, gecmisSayac, gecmisSuz } from "../mantik/taseronSaha";
import { para, saat, tarih } from "../mantik/bicim";
import { hataMetni } from "../mantik/hata";

const tutar = (v, pb) => (v === null || v === undefined ? "—" : para(v, pb));
const MONTAJ_AD = { BEKLIYOR: "Montaj bekliyor", DEVAM: "Montaj devam ediyor", TAMAMLANDI: "Montaj tamamlandı" };

function Cipler({ secenekler, deger, onSec, sayac }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: aralik.xs, paddingVertical: 2 }} style={{ marginBottom: aralik.s }}>
      {secenekler.map((f) => {
        const sec = deger === f.kod;
        return (
          <Pressable key={f.kod} onPress={() => onSec(f.kod)} accessibilityRole="tab" accessibilityState={{ selected: sec }}
            style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", height: 36, paddingHorizontal: 13, borderRadius: 18,
              backgroundColor: sec ? renk.lacivert : renk.yuzey, borderWidth: 1, borderColor: sec ? renk.lacivert : renk.cizgi }, pressed && { opacity: 0.8 }]}>
            <Metin tur="etiket" renk={sec ? "#FFFFFF" : renk.metin}>{f.ad}</Metin>
            {sayac ? <Metin tur="etiket" renk={sec ? "#C7D3E3" : renk.metinIkincil} style={{ marginLeft: 5 }}>{sayac[f.kod] ?? ""}</Metin> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
function Arama({ deger, onDegis, ipucu }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: renk.yuzey, borderRadius: kose.m, borderWidth: 1, borderColor: renk.cizgi, paddingHorizontal: aralik.s, marginBottom: aralik.s }}>
      <Ionicons name="search" size={18} color={renk.metinSoluk} />
      <TextInput value={deger} onChangeText={onDegis} placeholder={ipucu} placeholderTextColor={renk.metinSoluk} autoCapitalize="characters" autoCorrect={false}
        clearButtonMode="while-editing" accessibilityLabel={ipucu} style={{ flex: 1, fontSize: 16, paddingVertical: 10, paddingHorizontal: aralik.xs, color: renk.metin }} />
    </View>
  );
}
function MiniKart({ ad, deger, not, ton }) {
  return (
    <Kart style={{ flexBasis: "47%", flexGrow: 1, paddingVertical: aralik.s }} erisimEtiketi={`${ad}: ${deger}`}>
      <Metin tur="minik" renk={renk.metinIkincil} numberOfLines={2}>{ad}</Metin>
      <Metin tur="baslikM" renk={ton || renk.metin} style={[yazi.tutar, { marginTop: 2 }]} numberOfLines={1} adjustsFontSizeToFit>{deger}</Metin>
      {not ? <Metin tur="minik" renk={renk.metinSoluk}>{not}</Metin> : null}
    </Kart>
  );
}

// ── HAKEDİŞ VE CARİ ───────────────────────────────────────────────────────────────────────────────────────────────
export function TaseronCariEkrani({ navigation, route }) {
  const v = useVeri("taseronCari", () => taseronPanelApi.cari());
  const [sekme, setSekme] = useState(route?.params?.sekme || "hakedis");
  useEffect(() => { if (route?.params?.sekme) setSekme(route.params.sekme); }, [route?.params?.sekme]);
  const [arama, setArama] = useState("");
  const [acik, setAcik] = useState(null);
  const c = v.veri;
  const o = c?.ozet?.find((x) => x.para_birimi === "TRY") || c?.ozet?.[0] || null;
  const geri = !!route?.params?.yigin; // sekmede değil, başka ekrandan açıldıysa geri düğmesi
  const belgeAc = async (id) => {
    try { const r = await taseronPanelApi.cariBelge(id); if (r?.url) await Linking.openURL(r.url); }
    catch (e) { Alert.alert("Belge açılamadı", hataMetni(e)); }
  };
  return (
    <Ekran baslik="Hakediş ve Cari" geri={geri} altBaslik={c?.firma ? `${c.firma.ad}${c.guncel ? ` · ${tarih(c.guncel)} ${saat(c.guncel)}` : ""}` : undefined}
      yenileniyor={v.yenileniyor} onYenile={v.yenile}>
      {v.yukleniyor && !c ? <><IskeletKart yukseklik={140} /><IskeletKart /><IskeletKart /></> : null}
      {v.hata && !c ? <Kart><HataDurum hata={v.hata} baslik={v.hata?.tur === "yetki" ? "Bu bölüme erişiminiz yok" : "Cari bilgisi alınamadı"} onTekrar={v.hata?.tur === "yetki" ? undefined : v.yenile} /></Kart> : null}
      <EskiVeriBandi v={v} style={{ marginBottom: aralik.s }} />
      {c?.kart_yok ? <Kart><BosDurum ikon="card-outline" baslik="Cari kartı tanımlı değil" aciklama={c.mesaj} /></Kart> : null}
      {c && !c.kart_yok ? (
        <>
          {o ? (
            <Kart style={{ backgroundColor: renk.lacivert, marginBottom: aralik.s }} erisimEtiketi={`${o.yon.metin}: ${para(Math.abs(o.net), o.para_birimi)}`}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Metin tur="etiket" renk="#C7D3E3" style={{ flex: 1, textTransform: "uppercase", letterSpacing: 0.6 }}>Net cari · {c.donem?.ad || "Tüm dönem"}</Metin>
                <Rozet metin={o.yon.metin} tonAdi={YON_TON[o.yon.kod]} />
              </View>
              <Metin tur="baslikXL" renk="#FFFFFF" style={[yazi.tutar, { marginTop: aralik.xs }]}>{para(Math.abs(o.net), o.para_birimi)}</Metin>
              <Metin tur="minik" renk="#C7D3E3">{c.firma.model_ad}{c.donem?.baslangic ? ` · ${tarih(c.donem.baslangic)} – ${tarih(c.donem.bitis)}` : ""}</Metin>
            </Kart>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: aralik.s }}>
            {cariKartlari(o).map((k) => <MiniKart key={k.kod} ad={k.ad} deger={tutar(k.deger, o.para_birimi)} not={k.not}
              ton={k.kod === "acik_avans" && k.deger > 0 ? renk.uyari : k.kod === "hakedis_kalan" && k.deger > 0 ? renk.basari : undefined} />)}
          </View>
          {o?.plan_bedeli ? <Metin tur="minik" renk={renk.metinIkincil} style={{ marginTop: aralik.xs }}>Planlanan (PR) iş bedeli: {para(o.plan_bedeli, o.para_birimi)} · fiziki tamamlandıkça yapılan işe geçer</Metin> : null}
          {(c.uyarilar || []).map((u, i) => <Bant key={i} tonAdi="uyari" ikon="alert-circle-outline" metin={u} style={{ marginTop: aralik.s }} />)}
          <Bant tonAdi="bilgi" ikon="information-circle-outline" baslik="Nasıl hesaplanıyor?" metin={`${c.kural.is_bedeli} ${c.kural.tarife} ${c.kural.vergi}`} style={{ marginTop: aralik.s, marginBottom: aralik.s }} />

          <Cipler secenekler={CARI_SEKMELER} deger={sekme} onSec={(k) => { setSekme(k); setAcik(null); }}
            sayac={{ hakedis: c.hakedisler.length, odeme: c.odemeler.length, hareket: c.hareketler.reduce((t, h) => t + h.satirlar.length, 0), fatura: c.faturalar.length }} />

          {sekme === "hakedis" ? (
            <>
              <Arama deger={arama} onDegis={setArama} ipucu="Site ID, iş kodu ya da kalem kodu" />
              {!c.hakedisler.length ? <Kart><BosDurum ikon="construct-outline" baslik="Firmanıza kayıtlı iş kalemi yok" aciklama="Günlük iş girişine işiniz işlendiğinde burada görünür." /></Kart> : null}
              {hakedisArama(c.hakedisler, arama).map((h) => {
                const k = `${h.master_works_id}`;
                return (
                  <Kart key={k} style={{ marginBottom: aralik.xs }} onPress={() => setAcik(acik === k ? null : k)} erisimEtiketi={`${h.fiziksel_id} ${h.site_code}, ${h.fiyat_durum_ad}`}>
                    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Metin tur="baslikM">{h.fiziksel_id}</Metin>
                        <Metin tur="kucukKalin" numberOfLines={1}>{h.site_code}</Metin>
                        <Metin tur="kucuk" renk={renk.metinIkincil} numberOfLines={2}>{[h.item_code, h.aciklama].filter(Boolean).join(" · ")}</Metin>
                      </View>
                      <View style={{ alignItems: "flex-end", marginLeft: aralik.s }}>
                        <Metin tur="kucukKalin" style={yazi.tutar}>{tutar(h.bedel, h.para_birimi)}</Metin>
                        <Rozet metin={h.fiyat_durum_ad} tonAdi={FIYAT_TON[h.fiyat_durum] || "notr"} style={{ marginTop: 4 }} />
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: aralik.xs }}>
                      <Rozet metin={MONTAJ_AD[h.montaj.durum]} tonAdi={MONTAJ_TON[h.montaj.durum] || "notr"} ikon="construct-outline" />
                      {h.qc.saha || h.qc.kalem ? <Rozet metin={`QC ${h.qc.saha || h.qc.kalem}`} tonAdi={(h.qc.saha || h.qc.kalem) === "OK" ? "basari" : "notr"} ikon="shield-checkmark-outline" /> : null}
                      {h.paket ? <Rozet metin={h.paket} tonAdi="marka" /> : null}
                    </View>
                    {h.uyarilar.map((u, i) => <Metin key={i} tur="minik" renk={renk.uyari} style={{ marginTop: 4 }}>⚠︎ {u}</Metin>)}
                    {acik === k ? (
                      <View style={{ marginTop: aralik.s }}>
                        <BilgiSatiri etiket="İş tarihi" deger={h.is_tarihi ? `${tarih(h.is_tarihi)} (${h.is_tarihi_kaynak})` : "—"} />
                        <BilgiSatiri etiket="Uygulanan tarife" deger={h.tarife ? `${tarih(h.tarife.baslangic)} itibarıyla · ${h.tarife.kapsam}` : "Fiyat doğrulanamadı"} />
                        <BilgiSatiri etiket="PR miktarı" deger={String(h.pr_miktar)} />
                        <BilgiSatiri etiket="Fiziki miktar" deger={String(h.fiziki_miktar)} />
                        <BilgiSatiri etiket={h.birim_bedel_turu || "Birim bedel"} deger={tutar(h.birim_bedel, h.para_birimi)} />
                        <BilgiSatiri etiket="Hesaplanan bedel" deger={h.bedel === null ? "—" : `${para(h.bedel, h.para_birimi)} · ${h.kdv}`} />
                        <BilgiSatiri etiket="Montaj" deger={[h.montaj.baslangic && `başladı ${tarih(h.montaj.baslangic)}`, h.montaj.bitis && `bitti ${tarih(h.montaj.bitis)}`].filter(Boolean).join(" · ") || "—"} />
                        <BilgiSatiri etiket="QC (kalem / saha)" deger={`${h.qc.kalem || "—"} / ${h.qc.saha || "—"}${h.qc.kapanis ? ` · kapanış ${tarih(h.qc.kapanis)}` : ""}`} son />
                      </View>
                    ) : null}
                  </Kart>
                );
              })}
            </>
          ) : null}

          {sekme === "odeme" ? (
            <>
              {!c.odemeler.length ? <Kart><BosDurum ikon="wallet-outline" baslik="Kayıtlı ödeme ya da avans yok" /></Kart> : null}
              {c.odemeler.map((x) => (
                <Kart key={x.id} style={{ marginBottom: aralik.xs, opacity: x.tur === "IPTAL" ? 0.65 : 1 }} erisimEtiketi={`${x.tur_ad} ${para(x.tutar, x.para_birimi)} ${tarih(x.tarih)}`}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View style={{ flex: 1 }}>
                      <Metin tur="govdeKalin">{tarih(x.tarih)}</Metin>
                      <Metin tur="minik" renk={renk.metinIkincil} numberOfLines={2}>{[x.no, x.aciklama, x.dagilim?.length ? x.dagilim.map((d) => d.fatura_no).join(", ") : null, x.iptal_neden].filter(Boolean).join(" · ")}</Metin>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Metin tur="kucukKalin" style={[yazi.tutar, x.tur === "IPTAL" && { textDecorationLine: "line-through" }]}>{para(x.tutar, x.para_birimi)}</Metin>
                      <Rozet metin={x.tur_ad} tonAdi={ODEME_TON[x.tur] || "notr"} style={{ marginTop: 4 }} />
                    </View>
                  </View>
                  {x.belge_var ? (
                    <Pressable onPress={() => belgeAc(x.id)} accessibilityRole="button" style={{ marginTop: aralik.xs, flexDirection: "row", alignItems: "center", minHeight: 36 }}>
                      <Ionicons name="document-attach-outline" size={16} color={renk.lacivert} />
                      <Metin tur="kucukKalin" renk={renk.lacivert} style={{ marginLeft: 4 }}>Dekontu aç</Metin>
                    </Pressable>
                  ) : null}
                </Kart>
              ))}
              <Metin tur="minik" renk={renk.metinSoluk} style={{ marginTop: aralik.xs }}>Mahsup ve iptal kayıtları toplam ödemeye girmez. Bir ödeme bir kez sayılır.</Metin>
            </>
          ) : null}

          {sekme === "hareket" ? c.hareketler.map((g) => (
            <Kart key={g.para_birimi} style={{ marginBottom: aralik.s, paddingVertical: aralik.xs }}>
              <View style={{ flexDirection: "row", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: renk.cizgi }}>
                <Metin tur="etiket" renk={renk.metinIkincil} style={{ flex: 1.3 }}>Tarih · işlem</Metin>
                <Metin tur="etiket" renk={renk.metinIkincil} style={{ flex: 1, textAlign: "right" }}>Borç / Alacak</Metin>
                <Metin tur="etiket" renk={renk.metinIkincil} style={{ flex: 1, textAlign: "right" }}>Bakiye</Metin>
              </View>
              {!g.satirlar.length ? <Metin tur="kucuk" renk={renk.metinIkincil} style={{ paddingVertical: aralik.s }}>Hareket yok.</Metin> : null}
              {g.satirlar.map((s, i) => (
                <View key={i} style={{ flexDirection: "row", paddingVertical: 8, borderBottomWidth: i === g.satirlar.length - 1 ? 0 : 0.5, borderBottomColor: renk.cizgi }}>
                  <View style={{ flex: 1.3, paddingRight: 4 }}>
                    <Metin tur="kucukKalin">{tarih(s.tarih)} · {s.islem}</Metin>
                    <Metin tur="minik" renk={renk.metinIkincil} numberOfLines={2}>{[s.no, s.aciklama].filter(Boolean).join(" · ")}</Metin>
                  </View>
                  <Metin tur="kucuk" style={[yazi.tutar, { flex: 1, textAlign: "right" }]} renk={s.borc ? renk.metin : renk.basari}>{s.borc ? para(s.borc, g.para_birimi) : s.alacak ? `− ${para(s.alacak, g.para_birimi)}` : "—"}</Metin>
                  <Metin tur="kucukKalin" style={[yazi.tutar, { flex: 1, textAlign: "right" }]}>{para(s.bakiye, g.para_birimi)}</Metin>
                </View>
              ))}
              <Metin tur="minik" renk={renk.metinSoluk} style={{ marginTop: aralik.xs }}>Pozitif bakiye: firmanıza ödenecek · negatif bakiye: firmanızın açık avansı.</Metin>
            </Kart>
          )) : null}

          {sekme === "fatura" ? (
            <>
              {!c.faturalar.length ? <Kart><BosDurum ikon="receipt-outline" baslik="Henüz fatura kaydı yok" aciklama={c.fatura_bos_mesaj || "Hakediş ve ödemelerinizi diğer sekmelerden görebilirsiniz."} /></Kart> : null}
              {c.faturalar.map((f) => (
                <Kart key={f.id} style={{ marginBottom: aralik.xs }} onPress={() => navigation.navigate("TaseronFaturaDetay", { fatura: { id: f.id, fatura_no: f.fatura_no, fatura_tarihi: f.tarih, toplam_tutar: f.toplam, odenen_tutar: f.odenen, kalan_borc: f.acik, para_birimi: f.para_birimi } })}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View style={{ flex: 1 }}>
                      <Metin tur="govdeKalin">{f.fatura_no || `#${f.id}`}</Metin>
                      <Metin tur="minik" renk={renk.metinIkincil}>{tarih(f.tarih)} · {f.tur} · {f.kdv}</Metin>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Metin tur="kucukKalin" style={yazi.tutar}>{para(f.toplam, f.para_birimi)}</Metin>
                      <Metin tur="minik" renk={f.acik > 0 ? renk.uyari : renk.basari}>Açık {para(f.acik, f.para_birimi)}</Metin>
                    </View>
                  </View>
                </Kart>
              ))}
            </>
          ) : null}
        </>
      ) : null}
    </Ekran>
  );
}

// ── YAPTIĞIMIZ SAHALAR ────────────────────────────────────────────────────────────────────────────────────────────
const TARIH_SECIM = [{ kod: "tumu", ad: "Tüm tarihler" }, { kod: "kasim", ad: "1 Kasım'dan beri" }, { kod: "once", ad: "1 Kasım öncesi" }, { kod: "30", ad: "Son 30 gün" }];
const tarihAraligi = (kod) => {
  if (kod === "kasim") return { bas: "2026-11-01" };
  if (kod === "once") return { bit: "2026-10-31" };
  if (kod === "30") return { bas: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10) };
  return {};
};
export function TaseronYaptiklarimizEkrani({ navigation }) {
  const v = useVeri("taseronGecmis", () => taseronSahaApi.gecmis());
  const [filtre, setFiltre] = useState("tumu");
  const [arama, setArama] = useState("");
  const [bolge, setBolge] = useState(null);
  const [tarihSec, setTarihSec] = useState("tumu");
  const g = v.veri;
  const satirlar = g?.satirlar || [];
  const liste = useMemo(() => gecmisSuz(satirlar, { filtre, arama, bolge, ...tarihAraligi(tarihSec) }), [satirlar, filtre, arama, bolge, tarihSec]);
  const say = useMemo(() => gecmisSayac(satirlar), [satirlar]);
  const bl = useMemo(() => bolgeListesi(satirlar), [satirlar]);
  const s = g?.sayac;
  return (
    <Ekran baslik="Yaptığımız Sahalar" geri altBaslik={g?.firma?.ad ? `${g.firma.ad}${g.rol === "CALISAN" ? " · ekibiniz" : ""}` : undefined} yenileniyor={v.yenileniyor} onYenile={v.yenile}>
      {v.yukleniyor && !g ? <><IskeletKart yukseklik={140} /><IskeletKart /></> : null}
      {v.hata && !g ? <Kart><HataDurum hata={v.hata} baslik={v.hata?.tur === "yetki" ? "Bu bölüme erişiminiz yok" : "Saha geçmişi alınamadı"} onTekrar={v.hata?.tur === "yetki" ? undefined : v.yenile} /></Kart> : null}
      <EskiVeriBandi v={v} style={{ marginBottom: aralik.s }} />
      {s ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: aralik.s }}>
            <MiniKart ad="Montajı tamamlanan saha" deger={String(s.montaj_tamamlanan_saha)} not={`${s.montaj_tamamlanan_is} iş kaydı`} ton={renk.basari} />
            <MiniKart ad="QC süreci başlayan saha" deger={String(s.qc_baslayan_saha)} not="Smart QC görevi açık" />
            <MiniKart ad="QC kapanan saha" deger={String(s.qc_kapanan_saha)} not="QC OK" />
            <MiniKart ad="Devam eden / kısmi iş" deger={String(s.devam_kismi_is)} not={s.teyit_bekleyen_is ? `${s.teyit_bekleyen_is} iş teyit bekliyor` : undefined} ton={renk.uyari} />
            <MiniKart ad="Toplam iş kaydı" deger={String(s.toplam_is)} not={`${s.toplam_saha} fiziksel saha`} />
          </View>
          <Metin tur="minik" renk={renk.metinSoluk} style={{ marginTop: aralik.xs, marginBottom: aralik.s }}>{g.not}{s.kanitsiz_plan_is ? ` Yalnız planı olan ${s.kanitsiz_plan_is} iş listede yok.` : ""}</Metin>
          {s.qc_baslayan_saha === 0 ? <Bant tonAdi="notr" ikon="shield-outline" metin={g.qc_not} style={{ marginBottom: aralik.s }} /> : null}
          <Arama deger={arama} onDegis={setArama} ipucu="Site ID ya da iş kodu ara" />
          <Cipler secenekler={GECMIS_FILTRELER} deger={filtre} onSec={setFiltre} sayac={say} />
          <Cipler secenekler={TARIH_SECIM} deger={tarihSec} onSec={setTarihSec} />
          {bl.length > 1 ? <Cipler secenekler={[{ kod: null, ad: "Tüm bölgeler" }, ...bl.map((b) => ({ kod: b, ad: b }))]} deger={bolge} onSec={setBolge} /> : null}
          {!satirlar.length ? <Kart><BosDurum ikon="ribbon-outline" baslik="Kanıtı olan saha işi yok" aciklama="Montaj tarihi, fiziki miktar ya da saha raporu kayda geçtikçe burada görünür." /></Kart>
            : !liste.length ? <Kart><BosDurum ikon="search-outline" baslik="Bu filtreye uyan iş yok" eylem="Filtreyi temizle" onEylem={() => { setFiltre("tumu"); setArama(""); setBolge(null); setTarihSec("tumu"); }} /></Kart> : null}
          {liste.map((x) => {
            const sn = GECMIS_SINIF[x.sinif] || { ad: x.sinif, ton: "notr" };
            return (
              <Kart key={x.kod} style={{ marginBottom: aralik.xs }} onPress={() => navigation.navigate("TaseronSahaDetay", { kod: x.kod })} erisimEtiketi={`${x.fiziksel_id} ${x.kod}, ${sn.ad}, ${x.qc.ad}`}>
                <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Metin tur="baslikM">{x.fiziksel_id}</Metin>
                    <Metin tur="kucukKalin" numberOfLines={1}>{x.kod}</Metin>
                    <Metin tur="kucuk" renk={renk.metinIkincil} numberOfLines={1}>{[x.il, x.bolge, x.is_turu].filter(Boolean).join(" · ")}</Metin>
                  </View>
                  <Rozet metin={sn.ad} tonAdi={sn.ton} />
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: aralik.xs }}>
                  <Rozet metin={x.qc.ad} tonAdi={QC_TON[x.qc.kod] || "notr"} ikon="shield-checkmark-outline" />
                  {x.bedel_durumu ? <Rozet metin={x.bedel_durumu.ad} tonAdi={x.bedel_durumu.kod === "FIYAT_DOGRULANAMADI" ? "uyari" : "notr"} ikon="cash-outline" /> : null}
                </View>
                <Metin tur="minik" renk={renk.metinIkincil} style={{ marginTop: 6 }}>
                  {[x.montaj.baslama && `Başlangıç ${tarih(x.montaj.baslama)}`, x.montaj.bitis && `Bitiş ${tarih(x.montaj.bitis)}`, x.miktar && `Fiziki ${x.miktar.fiziki} / PR ${x.miktar.pr}`, x.qc.tarih && `QC ${tarih(x.qc.tarih)}`].filter(Boolean).join(" · ") || "Tarih kaydı yok"}
                </Metin>
                <Metin tur="minik" renk={renk.metinSoluk}>Kanıt: {x.kanit.join(", ")}{x.qc.ham?.length ? ` · ${x.qc.ham.join(", ")}` : ""}</Metin>
                {x.teyit ? <Metin tur="minik" renk={renk.uyari} style={{ marginTop: 4 }}>⚠︎ {x.teyit}</Metin> : null}
                {x.montaj_kaynagi ? <Metin tur="minik" renk={renk.metinSoluk} style={{ marginTop: 2 }}>{x.montaj_kaynagi}</Metin> : null}
                {x.bedel_durumu ? (
                  <Pressable onPress={() => navigation.navigate("TaseronCariYigin", { sekme: "hakedis" })} accessibilityRole="button" style={{ marginTop: 4, minHeight: 32, justifyContent: "center" }}>
                    <Metin tur="kucukKalin" renk={renk.lacivert}>Hakediş bilgisine git ›</Metin>
                  </Pressable>
                ) : null}
              </Kart>
            );
          })}
        </>
      ) : null}
    </Ekran>
  );
}
