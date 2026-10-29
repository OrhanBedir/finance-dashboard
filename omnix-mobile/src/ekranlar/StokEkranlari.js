// Malzemelerim (stok defteri, 29.10.2026): üzerimdeki kullanılabilir miktar, iade bekleyen, "Sahada kullandım", depoya iade,
// işlem geçmişi. Sunucu kimliği token'dan alır; personel / firma bilgisi gönderilmez. Kayıttan önce saha ve miktar özetlenir;
// gönderim sırasında düğme kilitlenir; form taslak olarak telefonda saklanır ve istek anahtarıyla gider — bağlantı koparsa
// aynı anahtarla yeniden denenir, ikinci kayıt oluşmaz; başarısız işlem başarılı gösterilmez.
import React, { useEffect, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { aralik, renk } from "../tema";
import { BolumBasligi, Buton, Kart, Metin, Rozet } from "../bilesenler/temel";
import { Bant, BosDurum, EskiVeriBandi, HataDurum, IskeletKart } from "../bilesenler/durum";
import { Alan, TarihAlani } from "../bilesenler/form";
import { Ekran } from "../bilesenler/Ekran";
import { useOturum } from "../oturum/OturumSaglayici";
import { useGecersizKil, useVeri } from "../api/veri";
import { stokApi } from "../api/uclar";
import { isoGun, tarih, tarihUzun } from "../mantik/bicim";
import { hataMetni } from "../mantik/hata";
import { miktarCoz, miktarGoster, stokIslemKontrol } from "../mantik/stok";
import { taslaklar, taslakKaydet, taslakSil, yeniKimlik } from "../taslak/taslakDepo";

const IADE_TR = { BEKLIYOR: { ad: "Depo onayı bekleniyor", ton: "uyari" }, ONAYLANDI: { ad: "Depoya alındı", ton: "basari" }, REDDEDILDI: { ad: "Reddedildi", ton: "hata" }, IPTAL: { ad: "Geri çekildi", ton: "notr" } };

export function Malzemelerim({ navigation, eski }) {
  const gecersizKil = useGecersizKil();
  const v = useVeri("stokBenim", () => stokApi.benim());
  const [bekle, setBekle] = useState(null);
  if (v.yukleniyor && !v.veri) return <><IskeletKart /><IskeletKart /></>;
  if (v.hata && !v.veri) return <Kart><HataDurum hata={v.hata} onTekrar={v.yenile} /></Kart>;
  const d = v.veri || {};
  if (!d.defter_acik) return (
    <View>
      <Bant tonAdi="uyari" baslik="Stok sistemine geçiş" metin="Depo sayımı ve açılış onayından sonra üzerinizdeki malzemeler burada görünecek. Bu arada iade / sahaya çıkış yapılamaz; aşağıdaki liste eski kayıttır." style={{ marginBottom: aralik.m }} />
      {eski}
    </View>
  );
  const stok = d.stok || [];
  const bekleyen = (d.iadeler || []).filter((i) => i.durum === "BEKLIYOR");
  const geriCek = (i) => Alert.alert("İade talebini geri çek", `${i.urun_ad} · ${miktarGoster(i.miktar)} ${i.temel_birim}\nMiktar yeniden kullanılabilir olur.`, [
    { text: "Vazgeç", style: "cancel" },
    { text: "Geri çek", onPress: async () => {
      setBekle(i.id);
      try { await stokApi.iadeIptal(i.id, `iptal-${i.id}`); gecersizKil(["stokBenim"]); }
      catch (e) { Alert.alert("Geri çekilemedi", hataMetni(e)); }
      finally { setBekle(null); }
    } },
  ]);
  return (
    <View>
      <EskiVeriBandi v={v} style={{ marginBottom: aralik.s }} />
      {stok.length === 0 ? <Kart><BosDurum ikon="cube-outline" baslik="Üzerinizde kayıtlı malzeme yok" aciklama="Depodan teslim aldığınız malzemeler burada görünür." /></Kart> : stok.map((s) => (
        <Kart key={s.urun_id} style={{ marginBottom: aralik.s }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
            <View style={{ flex: 1, paddingRight: aralik.s }}>
              <Metin tur="govdeKalin">{s.ad}</Metin>
              <Metin tur="minik" renk={renk.metinSoluk}>{s.kod}{s.tur === "EKIPMAN" ? " · ekipman (tüketilmez, iade edilir)" : ""}</Metin>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Metin tur="baslikM" renk={renk.basari}>{miktarGoster(s.kullanilabilir)} <Metin tur="kucuk" renk={renk.basari}>{s.temel_birim}</Metin></Metin>
              <Metin tur="minik" renk={renk.metinIkincil}>kullanılabilir</Metin>
              {s.iade_bekleyen > 0 ? <Metin tur="minik" renk={renk.uyari}>+ {miktarGoster(s.iade_bekleyen)} iade onayı bekliyor</Metin> : null}
            </View>
          </View>
          {s.kullanilabilir > 0 ? (
            <View style={{ flexDirection: "row", gap: aralik.s, marginTop: aralik.m }}>
              {s.tur !== "EKIPMAN" ? <Buton baslik="Sahada kullandım" ikon="construct-outline" kucuk onPress={() => navigation.navigate("StokIslem", { tur: "tuketim", urun: s })} style={{ flex: 1.2 }} /> : null}
              <Buton baslik="Depoya iade" tur="ikincil" kucuk onPress={() => navigation.navigate("StokIslem", { tur: "iade", urun: s })} style={{ flex: 1 }} />
            </View>
          ) : null}
        </Kart>
      ))}
      {bekleyen.length ? (
        <>
          <BolumBasligi baslik="Bekleyen iadelerim" />
          {bekleyen.map((i) => (
            <Kart key={i.id} style={{ marginBottom: aralik.s }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Metin tur="kucukKalin">{i.urun_ad} · {miktarGoster(i.miktar)} {i.temel_birim}</Metin>
                  <Metin tur="minik" renk={renk.metinSoluk}>{tarih(i.talep_tarihi)} · depo teslim alıp onaylayınca üzerinizden düşer</Metin>
                </View>
                <Buton baslik="Geri çek" tur="metin" kucuk onPress={() => geriCek(i)} yukleniyor={bekle === i.id} devreDisi={!!bekle} />
              </View>
            </Kart>
          ))}
        </>
      ) : null}
      {(d.hareketler || []).length ? (
        <>
          <BolumBasligi baslik="İşlem geçmişim" />
          <Kart style={{ paddingVertical: aralik.xs }}>
            {d.hareketler.slice(0, 30).map((h, i, ar) => (
              <View key={h.id} style={{ paddingVertical: aralik.s, borderBottomWidth: i === ar.length - 1 ? 0 : 1, borderBottomColor: renk.cizgi, opacity: h.iptal_edildi ? 0.5 : 1 }}>
                <View style={{ flexDirection: "row" }}>
                  <Metin tur="kucukKalin" style={{ flex: 1 }}>{h.tur_ad}{h.iptal_edildi ? " (düzeltildi)" : ""}</Metin>
                  <Metin tur="kucukKalin">{miktarGoster(h.miktar)} {h.temel_birim}</Metin>
                </View>
                <Metin tur="minik" renk={renk.metinSoluk}>{[tarih(h.islem_tarihi), h.urun_ad, h.saha_kodu, h.aciklama].filter(Boolean).join(" · ")}</Metin>
              </View>
            ))}
          </Kart>
        </>
      ) : null}
      {(d.iadeler || []).filter((i) => i.durum !== "BEKLIYOR").slice(0, 10).map((i) => (
        <View key={`i${i.id}`} style={{ flexDirection: "row", alignItems: "center", marginTop: aralik.xs }}>
          <Metin tur="minik" renk={renk.metinSoluk} style={{ flex: 1 }}>İade · {i.urun_ad} {miktarGoster(i.miktar)} {i.temel_birim}{i.karar_aciklama ? ` · ${i.karar_aciklama}` : ""}</Metin>
          <Rozet metin={IADE_TR[i.durum]?.ad || i.durum} tonAdi={IADE_TR[i.durum]?.ton || "notr"} />
        </View>
      ))}
    </View>
  );
}

// Saha seçimi: kendisine atanan sahalar önce; arama 2+ karakterde firma kapsamındaki Rollout sahaları. Serbest kod yazılabilir
// ama sunucu listede olmayan / kapsam dışı sahayı reddeder (sessiz kayıt yok).
function SahaSecici({ deger, onSec }) {
  const [oneri, setOneri] = useState({ atanan: [], diger: [] });
  useEffect(() => {
    let iptal = false;
    const t = setTimeout(() => { stokApi.sahalarim(deger).then((j) => { if (!iptal) setOneri({ atanan: j.atanan || [], diger: j.diger || [] }); }).catch(() => {}); }, 300);
    return () => { iptal = true; clearTimeout(t); };
  }, [deger]);
  const liste = [...oneri.atanan.map((x) => ({ ...x, atanan: true })), ...oneri.diger].filter((x) => x.saha_kodu !== deger).slice(0, 8);
  return (
    <View style={{ marginBottom: aralik.m }}>
      <Alan etiket="Saha kodu" zorunlu deger={deger} onDegis={(x) => onSec(x.toUpperCase().replace(/\s+/g, ""))} buyukHarf="characters" ipucu="Listeden seçin ya da yazın" style={{ marginBottom: aralik.xs }} />
      {liste.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: aralik.xs }}>
          {liste.map((x) => (
            <Pressable key={x.saha_kodu} onPress={() => onSec(x.saha_kodu)} accessibilityRole="button" accessibilityLabel={`Saha ${x.saha_kodu}${x.atanan ? ", size atanan" : ""}`}
              style={{ paddingHorizontal: aralik.s, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: x.atanan ? renk.basari : renk.cizgi, backgroundColor: x.atanan ? "#ECFDF5" : "#fff" }}>
              <Metin tur="kucukKalin" renk={x.atanan ? renk.basari : renk.metin}>{x.saha_kodu}{x.atanan ? " · atanan" : ""}</Metin>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function StokIslemEkrani({ route, navigation }) {
  const { tur, urun } = route.params;
  const { kapsam } = useOturum();
  const gecersizKil = useGecersizKil();
  const [f, setF] = useState({ miktar: tur === "iade" ? String(urun.kullanilabilir).replace(".", ",") : "", saha_kodu: "", tarih: isoGun(), aciklama: "" });
  const [taslakId, setTaslakId] = useState(null);
  const [anahtar, setAnahtar] = useState(null);
  const [kontrol, setKontrol] = useState(false);
  const [bekle, setBekle] = useState(false);
  const [hata, setHata] = useState(null);
  const kilit = useRef(false);
  const hazir = useRef(false);

  // Yarım kalan / bağlantı hatasında kalan aynı işlem taslağı geri yüklenir (istek anahtarıyla birlikte)
  useEffect(() => {
    taslaklar(kapsam, "stok").then((l) => {
      const t = l.find((x) => x.alanlar?.tur === tur && x.alanlar?.urun_id === urun.urun_id);
      if (t) { setF(t.alanlar.f); setTaslakId(t.id); setAnahtar(t.alanlar.anahtar || null); setHata(t.gonderimHatasi || null); }
      hazir.current = true;
    });
  }, [kapsam, tur, urun.urun_id]);
  useEffect(() => {
    if (!hazir.current || (!f.miktar && !f.saha_kodu && !f.aciklama)) return;
    const z = setTimeout(() => {
      taslakKaydet(kapsam, { id: taslakId || undefined, tur: "stok", alanlar: { tur, urun_id: urun.urun_id, f, anahtar } }).then((t) => setTaslakId(t.id)).catch(() => {});
    }, 400);
    return () => clearTimeout(z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);

  const degis = (k, v) => { setF((x) => ({ ...x, [k]: v })); setKontrol(false); };
  const kontrolEt = () => {
    const h = stokIslemKontrol({ tur, miktar: f.miktar, kullanilabilir: urun.kullanilabilir, sahaKodu: f.saha_kodu, tamSayi: urun.tam_sayi });
    setHata(h); setKontrol(!h);
  };
  const kaydet = async () => {
    if (kilit.current) return;
    kilit.current = true; setBekle(true); setHata(null);
    const m = miktarCoz(f.miktar);
    // Anahtar ilk denemede üretilir ve taslağa yazılır; tekrar denemede aynısı gider
    const k = anahtar || yeniKimlik();
    let tid = taslakId;
    try {
      if (!anahtar) setAnahtar(k);
      const t = await taslakKaydet(kapsam, { id: tid || undefined, tur: "stok", alanlar: { tur, urun_id: urun.urun_id, f, anahtar: k } });
      tid = t.id; setTaslakId(t.id);
      const govde = { istek_anahtari: k, urun_id: urun.urun_id, miktar: m.metin, aciklama: f.aciklama.trim() };
      const j = tur === "tuketim" ? await stokApi.tuketim({ ...govde, saha_kodu: f.saha_kodu, tarih: f.tarih }) : await stokApi.iade(govde);
      await taslakSil(kapsam, tid);
      gecersizKil(["stokBenim"]);
      Alert.alert(tur === "tuketim" ? "Kullanım kaydedildi" : "İade talebi gönderildi",
        (j.tekrar ? "Bu kayıt daha önce alınmıştı; ikinci kez yazılmadı.\n" : "") + (tur === "tuketim"
          ? `${j.saha_kodu} sahasında ${miktarGoster(j.miktar)} ${j.birim}. Üzerinizde kalan: ${miktarGoster(j.kalan)} ${j.birim}.`
          : "Depo malzemeyi teslim alıp onaylayınca üzerinizden düşer. O zamana kadar bu miktar kullanılamaz."));
      navigation.goBack();
    } catch (e) {
      const mesaj = e?.sonucBelirsiz
        ? "Bağlantı koptu; kaydın alınıp alınmadığı bilinmiyor. Bilgiler telefonda saklandı — tekrar deneyin, ikinci kez kaydedilmez."
        : hataMetni(e, "Kaydedilemedi.");
      setHata(mesaj); setKontrol(false);
      taslakKaydet(kapsam, { id: tid || undefined, tur: "stok", alanlar: { tur, urun_id: urun.urun_id, f, anahtar: k }, gonderimHatasi: mesaj }).then((t) => setTaslakId(t.id)).catch(() => {});
    } finally { kilit.current = false; setBekle(false); }
  };

  const m = miktarCoz(f.miktar);
  return (
    <Ekran baslik={tur === "tuketim" ? "Sahada kullandım" : "Depoya iade"} altBaslik={urun.ad} klavye alt={
      !kontrol ? <Buton baslik="Kontrol et" ikon="checkmark-circle-outline" onPress={kontrolEt} devreDisi={bekle} />
        : (
          <View style={{ flexDirection: "row", gap: aralik.s }}>
            <Buton baslik="Düzelt" tur="ikincil" onPress={() => setKontrol(false)} devreDisi={bekle} style={{ flex: 1 }} />
            <Buton baslik="Onayla ve kaydet" tur="basari" onPress={kaydet} yukleniyor={bekle} devreDisi={bekle} style={{ flex: 1.5 }} />
          </View>
        )}>
      {hata ? <Bant tonAdi="uyari" metin={hata} style={{ marginBottom: aralik.m }} /> : null}
      <Kart style={{ marginBottom: aralik.m }}>
        <Metin tur="kucuk" renk={renk.metinIkincil}>Üzerinizde kullanılabilir</Metin>
        <Metin tur="baslikM" renk={renk.basari}>{miktarGoster(urun.kullanilabilir)} {urun.temel_birim}</Metin>
        {urun.iade_bekleyen > 0 ? <Metin tur="minik" renk={renk.uyari}>{miktarGoster(urun.iade_bekleyen)} {urun.temel_birim} iade onayı bekliyor (kullanılamaz)</Metin> : null}
      </Kart>
      {tur === "tuketim" ? <SahaSecici deger={f.saha_kodu} onSec={(v) => degis("saha_kodu", v)} /> : null}
      <Alan etiket={`Miktar (${urun.temel_birim})`} zorunlu deger={f.miktar} onDegis={(v) => degis("miktar", v)} klavye="decimal-pad" ipucu="Örn. 12,5" yardim="Virgüllü yazabilirsiniz (en fazla 3 ondalık)." />
      {tur === "tuketim" ? <TarihAlani etiket="Kullanım tarihi" zorunlu deger={f.tarih} onDegis={(v) => degis("tarih", v)} /> : null}
      <Alan etiket="Açıklama" deger={f.aciklama} onDegis={(v) => degis("aciklama", v)} ipucu={tur === "tuketim" ? "Örn. topraklama hattı" : "Örn. iş bitti, artan"} />
      {kontrol ? (
        <Kart style={{ borderWidth: 1, borderColor: renk.lacivertAcik, backgroundColor: "#F5F8FF" }}>
          <Metin tur="kucukKalin" style={{ marginBottom: aralik.xs }}>Kaydedilecek</Metin>
          {tur === "tuketim" ? (
            <Metin tur="govde"><Metin tur="govdeKalin">{f.saha_kodu}</Metin> sahasında <Metin tur="govdeKalin">{miktarGoster(m.sayi)} {urun.temel_birim}</Metin> {urun.ad} kullanıldı ({tarihUzun(f.tarih)}).</Metin>
          ) : (
            <Metin tur="govde"><Metin tur="govdeKalin">{miktarGoster(m.sayi)} {urun.temel_birim}</Metin> {urun.ad} için depoya iade talebi. Onaylanana kadar bu miktar kullanılamaz.</Metin>
          )}
          <Metin tur="minik" renk={renk.metinSoluk} style={{ marginTop: aralik.xs }}>Kalan (tahmini): {miktarGoster(Math.round((Number(urun.kullanilabilir) - (m.sayi || 0)) * 1000) / 1000)} {urun.temel_birim}</Metin>
        </Kart>
      ) : null}
    </Ekran>
  );
}
