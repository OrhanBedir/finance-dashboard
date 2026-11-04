// Saha haritası (02.11.2026, Orhan): Rollout sahaları Türkiye haritasında.
// Kim neyi görür SUNUCUDA belirlenir (/mobil/harita): personel yalnız kendine atanmış işlerin sahalarını; yetkili yöneticiler
// web Rollout haritasının tüm sahalarını görür ve filtreler. Harita web ile aynı saf SVG il haritasıdır (harici harita servisi /
// API anahtarı yok); yol tarifi telefonun kendi harita uygulamasında açılır. Kesin konumu olmayan sahalar il merkezinde
// "yaklaşık" balon olarak gösterilir — koordinat uydurulmaz.
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, Linking, Modal, PanResponder, Platform, Pressable, ScrollView, StatusBar, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, G, Path, Text as SvgText } from "react-native-svg";
import { aralik, golge, kose, renk } from "../tema";
import { Buton, Metin } from "../bilesenler/temel";
import { BosDurum, HataDurum, Yukleniyor } from "../bilesenler/durum";
import { useVeri } from "../api/veri";
import { haritaApi } from "../api/uclar";
import { hataMetni } from "../mantik/hata";
import { ILLER } from "../harita/iller";
import { BOS_FILTRE, filtreSayisi, ilAdi, ilAnahtar, katmanlar, oranla, PIN_AD, PIN_RENK, PIN_SIRA, secenekler, sigdir, sinirla, suz, TUM_TURKIYE,
  yolTarifiAdresi } from "../harita/haritaMantik";

const DENIZ = "#DCE7F2";
const IL_DOLGU = "#F8FAFD", IL_AKTIF = "#E9F0F9", IL_CIZGI = "#C3CFDD";

export function SahaHaritaEkrani({ navigation }) {
  const kenar = useSafeAreaInsets();
  useFocusEffect(React.useCallback(() => { StatusBar.setBarStyle("light-content", true); return () => StatusBar.setBarStyle("dark-content", true); }, []));
  const v = useVeri("sahaHarita", () => haritaApi.sahalar());
  const veri = v.veri;
  const tum = !!veri?.tum_saha;
  const [f, setF] = useState(BOS_FILTRE);
  const [panel, setPanel] = useState(null); // { tur: "saha", s } | { tur: "il", g } | { tur: "liste" } | { tur: "filtre", alan }
  const sahalar = veri?.sahalar || [];
  const suzulmus = useMemo(() => suz(sahalar, f), [sahalar, f]);
  const sec = useMemo(() => secenekler(sahalar), [sahalar]);
  const k = useMemo(() => katmanlar(suzulmus), [suzulmus]);
  const fSayi = filtreSayisi(f);

  const altBaslik = !veri ? "Yükleniyor…" : tum ? `${veri.kapsam ? `${veri.kapsam} kapsamı · ` : ""}${sahalar.length} saha` : `Size atanmış ${sahalar.length} saha`;
  const CIPLER = [
    tum && veri?.ozet?.benim ? { alan: "benim", ad: "Benim işlerim", ikon: "person" } : null,
    { alan: "renk", ad: "Durum", ikon: "ellipse" },
    sec.bolge.length > 1 ? { alan: "bolge", ad: "Bölge", ikon: "map" } : null,
    sec.il.length > 1 ? { alan: "il", ad: "İl", ikon: "location" } : null,
    tum && sec.firma.length > 1 ? { alan: "firma", ad: "Taşeron", ikon: "business" } : null,
    tum && sec.ekip.length > 1 ? { alan: "ekip", ad: "Ekip", ikon: "people" } : null,
    tum && sec.durum.length > 1 ? { alan: "durum", ad: "Fiilî durum", ikon: "pulse" } : null,
  ].filter(Boolean);

  return (
    <View style={{ flex: 1, backgroundColor: DENIZ }}>
      {/* Üst bölüm: lacivert başlık + arama + filtre çipleri */}
      <View style={{ backgroundColor: renk.lacivert, paddingTop: kenar.top, paddingBottom: aralik.s }}>
        <View style={{ flexDirection: "row", alignItems: "center", minHeight: 52, paddingHorizontal: aralik.xs }}>
          <IkonDugme ad="chevron-back" renkAdi="#FFFFFF" onPress={() => navigation.goBack()} etiket="Geri" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Metin tur="baslikM" renk="#FFFFFF" style={{ fontWeight: "700" }} accessibilityRole="header">Saha Haritası</Metin>
            <Metin tur="minik" renk="#B8C7DA" numberOfLines={1}>{altBaslik}</Metin>
          </View>
          <IkonDugme ad="list" renkAdi="#FFFFFF" onPress={() => setPanel({ tur: "liste" })} etiket="Saha listesi" />
          <IkonDugme ad="refresh" renkAdi="#FFFFFF" onPress={v.yenile} etiket="Yenile" />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", marginHorizontal: aralik.m, marginTop: 2, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: kose.m, paddingHorizontal: aralik.s }}>
          <Ionicons name="search" size={18} color="#B8C7DA" />
          <TextInput value={f.arama} onChangeText={(t) => setF((x) => ({ ...x, arama: t }))} placeholder="Site ID, saha adı veya il ara" placeholderTextColor="#8FA3BC"
            autoCapitalize="characters" autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" accessibilityLabel="Saha ara"
            style={{ flex: 1, color: "#FFFFFF", fontSize: 16, paddingVertical: 10, paddingHorizontal: aralik.xs }} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: aralik.m, paddingTop: aralik.s, gap: aralik.xs }}>
          {CIPLER.map((c) => {
            const aktif = c.alan === "benim" ? f.benim : f[c.alan]?.length > 0;
            const say = c.alan === "benim" ? 0 : f[c.alan]?.length || 0;
            return (
              <Pressable key={c.alan} accessibilityRole="button" accessibilityState={{ selected: aktif }}
                onPress={() => (c.alan === "benim" ? setF((x) => ({ ...x, benim: !x.benim })) : setPanel({ tur: "filtre", alan: c.alan, ad: c.ad }))}
                style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", height: 34, paddingHorizontal: 12, borderRadius: 17,
                  backgroundColor: aktif ? renk.altin : "rgba(255,255,255,0.14)" }, pressed && { opacity: 0.8 }]}>
                <Ionicons name={aktif && c.alan === "benim" ? "checkmark-circle" : `${c.ikon}-outline`} size={15} color={aktif ? renk.lacivertKoyu : "#DCE5F0"} />
                <Metin tur="etiket" renk={aktif ? renk.lacivertKoyu : "#FFFFFF"} style={{ marginLeft: 6 }}>{c.ad}{say ? ` · ${say}` : ""}</Metin>
                {c.alan !== "benim" ? <Ionicons name="chevron-down" size={14} color={aktif ? renk.lacivertKoyu : "#B8C7DA"} style={{ marginLeft: 3 }} /> : null}
              </Pressable>
            );
          })}
          {fSayi ? (
            <Pressable onPress={() => setF((x) => ({ ...BOS_FILTRE, arama: x.arama }))} accessibilityRole="button"
              style={{ flexDirection: "row", alignItems: "center", height: 34, paddingHorizontal: 12 }}>
              <Ionicons name="close-circle" size={16} color="#F5C26B" />
              <Metin tur="etiket" renk="#F5C26B" style={{ marginLeft: 4 }}>Temizle</Metin>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>

      {/* Harita */}
      <View style={{ flex: 1 }}>
        {v.yukleniyor && !veri ? <Yukleniyor metin="Sahalar yükleniyor…" style={{ flex: 1 }} />
          : v.hata && !veri ? <View style={{ flex: 1, justifyContent: "center", padding: aralik.l }}><HataDurum hata={v.hata} onTekrar={v.yenile} /></View>
          : (
            <HaritaTuvali k={k} sahalar={suzulmus} secili={panel?.tur === "saha" ? panel.s.id : panel?.tur === "il" ? `il:${panel.g.anahtar}` : null}
              onSaha={(s) => setPanel({ tur: "saha", s })} onIl={(g) => setPanel({ tur: "il", g })} aktifIller={k.balonlar.map((b) => b.anahtar)}
              alt={kenar.bottom} toplam={sahalar.length} onListe={() => setPanel({ tur: "liste" })} benimGoster={tum && !!veri?.ozet?.benim} />
          )}
        {veri && sahalar.length === 0 ? (
          <View style={{ position: "absolute", left: aralik.m, right: aralik.m, top: aralik.xl }}>
            <View style={[{ backgroundColor: renk.yuzey, borderRadius: kose.l, padding: aralik.m }, golge]}>
              <BosDurum ikon="map-outline" baslik={tum ? "Haritada gösterilecek saha yok" : "Size atanmış saha yok"}
                aciklama={tum ? "Kapsamdaki Rollout kayıtları geldiğinde burada görünür." : "Merkezden iş atandığında sahalarınız burada görünür."} />
            </View>
          </View>
        ) : null}
      </View>

      <AltPanel panel={panel} onKapat={() => setPanel(null)} f={f} setF={setF} sec={sec} suzulmus={suzulmus} tum={tum}
        onSaha={(s) => setPanel({ tur: "saha", s })} navigation={navigation} />
    </View>
  );
}

function IkonDugme({ ad, onPress, etiket, renkAdi = renk.lacivert, zemin }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={etiket}
      style={({ pressed }) => [{ width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: zemin }, pressed && { opacity: 0.6 }]}>
      <Ionicons name={ad} size={22} color={renkAdi} />
    </Pressable>
  );
}

// ── Harita tuvali: SVG il haritası + pinler + yaklaşık il balonları; sürükle / iki parmakla yakınlaştır ─────────────────────
// 04.11.2026: taşeron saha ekranı da kullanır — lejant: [{ renk, ad }] (verilmezse saha durum renkleri), yaklasikLejant=false:
// "Yaklaşık (il)" lejantı gösterilmez (taşeron ekranında konumsuz iş haritaya hiç girmez)
export function HaritaTuvali({ k, sahalar, secili, onSaha, onIl, aktifIller, alt, toplam, onListe, benimGoster, lejant, yaklasikLejant = true }) {
  const [boyut, setBoyut] = useState(null);
  const kutuRef = useRef(null);
  const oran = boyut ? boyut.w / boyut.h : 0;
  const [vb, setVb] = useState(null);
  const tx = useRef(new Animated.Value(0)).current, ty = useRef(new Animated.Value(0)).current, sc = useRef(new Animated.Value(1)).current;
  const canli = useRef({ s: 1, x: 0, y: 0 });
  const sifirla = useRef(false);
  const vbRef = useRef(vb); vbRef.current = vb;
  const boyutRef = useRef(boyut); boyutRef.current = boyut;

  const tumNoktalar = useMemo(() => [...k.pinler, ...k.balonlar], [k]);
  // Alttaki özet kartı (~150 pt) haritanın altını örter: sığdırırken o pay kadar aşağı boşluk bırakılır
  const sigdirVb = () => {
    const v = sigdir(tumNoktalar, oran);
    const pay = boyut ? Math.min((150 + alt) / boyut.h, 0.4) : 0;
    setVb(sinirla(oranla({ ...v, h: v.h / (1 - pay) }, oran), oran));
  };
  // İlk açılış ve filtre değişince görünüm sahalara sığdırılır
  const imza = useMemo(() => sahalar.map((s) => s.id).join("|"), [sahalar]);
  React.useEffect(() => { if (oran) sigdirVb(); }, [oran, imza]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hareket bitince dönüşüm görünüm kutusuna işlenir; sıfırlama boyamadan önce yapılır (titreme olmaz)
  useLayoutEffect(() => { if (sifirla.current) { sifirla.current = false; tx.setValue(0); ty.setValue(0); sc.setValue(1); canli.current = { s: 1, x: 0, y: 0 }; } }, [vb]);
  const isle = () => {
    const B = boyutRef.current, V = vbRef.current; if (!B || !V) return;
    const { s, x, y } = canli.current;
    if (s === 1 && x === 0 && y === 0) return;
    const kat = V.w / B.w, cx = B.w / 2, cy = B.h / 2;
    const yeni = { x: V.x + kat * (cx + (0 - cx - x) / s), y: V.y + kat * (cy + (0 - cy - y) / s), w: V.w / s, h: V.h / s };
    sifirla.current = true;
    setVb(sinirla(yeni, B.w / B.h));
  };
  const bas = useRef(null);
  const dokunma = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (e, g) => e.nativeEvent.touches.length === 2 || Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
    onPanResponderGrant: () => { bas.current = null; },
    onPanResponderMove: (e) => {
      const t = e.nativeEvent.touches; const B = boyutRef.current; if (!B || !t.length) return;
      const iki = t.length >= 2;
      // pageX/Y kullanılır (locationX dokunulan alt öğeye göredir); tuvalin ekrandaki yeri onLayout'ta ölçülür
      const px = B.px || 0, py = B.py || 0;
      const orta = iki ? { x: (t[0].pageX + t[1].pageX) / 2 - px, y: (t[0].pageY + t[1].pageY) / 2 - py } : { x: t[0].pageX - px, y: t[0].pageY - py };
      const mesafe = iki ? Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY) : 0;
      // Parmak sayısı değişince o ana kadarki hareket işlenir, yeni hareket sıfırdan başlar
      if (!bas.current || bas.current.iki !== iki) {
        bas.current = { iki, orta, mesafe, s0: canli.current.s, x0: canli.current.x, y0: canli.current.y };
      }
      const b = bas.current;
      const s = iki && b.mesafe > 0 ? Math.min(Math.max(b.s0 * (mesafe / b.mesafe), 0.35), 12) : b.s0;
      // Başlangıç orta noktası parmakların altında kalır: t = M − C − s/s0·(M0 − C − t0)
      const cx = B.w / 2, cy = B.h / 2, r = s / b.s0;
      const x = orta.x - cx - r * (b.orta.x - cx - b.x0), y = orta.y - cy - r * (b.orta.y - cy - b.y0);
      canli.current = { s, x, y };
      sc.setValue(s); tx.setValue(x); ty.setValue(y);
    },
    onPanResponderRelease: () => { bas.current = null; isle(); },
    onPanResponderTerminate: () => { bas.current = null; isle(); },
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const yakinlas = (kat) => { if (!vb) return; const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2; setVb(sinirla({ x: cx - (vb.w * kat) / 2, y: cy - (vb.h * kat) / 2, w: vb.w * kat, h: vb.h * kat }, oran)); };

  const kat = vb && boyut ? vb.w / boyut.w : 1; // 1 ekran noktası = kat harita birimi (pinler sabit boyutta çizilir)
  const yakin = vb ? vb.w < 260 : false;
  const cokYakin = vb ? vb.w < 110 : false;
  const aktif = useMemo(() => new Set(aktifIller), [aktifIller]);
  const pinIl = useMemo(() => new Set(k.pinler.map((p) => ilAnahtar(p.s.il))), [k]);

  return (
    <View ref={kutuRef} style={{ flex: 1, overflow: "hidden" }} onLayout={(e) => {
      const { width, height } = e.nativeEvent.layout; if (!(width > 0 && height > 0)) return;
      setBoyut({ w: width, h: height });
      kutuRef.current?.measureInWindow?.((x, y) => { boyutRef.current = { w: width, h: height, px: x, py: y }; setBoyut({ w: width, h: height, px: x, py: y }); });
    }}>
      {boyut && vb ? (
        <Animated.View style={{ flex: 1, transform: [{ translateX: tx }, { translateY: ty }, { scale: sc }] }} {...dokunma.panHandlers}>
          <Svg width={boyut.w} height={boyut.h} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}>
            <G>
              {ILLER.map((il) => {
                const a = ilAnahtar(il.ad);
                const dolu = aktif.has(a) || pinIl.has(a);
                return <Path key={il.ad} d={il.d} fill={dolu ? IL_AKTIF : IL_DOLGU} stroke={IL_CIZGI} strokeWidth={0.9 * kat} strokeLinejoin="round" />;
              })}
            </G>
            {/* İl adları: yakınlaşınca */}
            {yakin ? ILLER.map((il) => (
              <SvgText key={`ad-${il.ad}`} x={il.cx} y={il.cy + (aktif.has(ilAnahtar(il.ad)) ? 26 * kat : 0)} fontSize={11 * kat} fill="#8494A7" fontWeight="600" textAnchor="middle">{il.ad}</SvgText>
            )) : null}
            {/* Yaklaşık konum balonları (il merkezi, kesikli çerçeve) */}
            {/* Büyük balonlar altta, küçükler üstte (komşu küçük illerde sayı okunur kalsın) */}
            {[...k.balonlar].sort((a, b) => b.sahalar.length - a.sahalar.length).map((g) => {
              const n = g.sahalar.length;
              const r = (11 + Math.min(Math.sqrt(n) * 1.5, 9)) * kat;
              const sec = secili === `il:${g.anahtar}`;
              return (
                <G key={`b-${g.anahtar}`} onPress={() => onIl(g)}>
                  <Circle cx={g.x} cy={g.y} r={r + 6 * kat} fill="transparent" />
                  <Circle cx={g.x} cy={g.y} r={r} fill={sec ? PIN_RENK[g.renk] : "#FFFFFF"} stroke={PIN_RENK[g.renk]} strokeWidth={2.4 * kat} strokeDasharray={`${4 * kat} ${2.5 * kat}`} />
                  <SvgText x={g.x} y={g.y + 4.2 * kat} fontSize={(n > 99 ? 10 : 12) * kat} fontWeight="800" fill={sec ? "#FFFFFF" : PIN_RENK[g.renk]} textAnchor="middle">{n}</SvgText>
                  {benimGoster && g.benim ? <Circle cx={g.x + r * 0.72} cy={g.y - r * 0.72} r={4.5 * kat} fill={renk.altin} stroke="#FFFFFF" strokeWidth={1.5 * kat} /> : null}
                </G>
              );
            })}
            {/* Kesin konumlu sahalar */}
            {k.pinler.map(({ s, x, y }) => {
              const sec = secili === s.id;
              const c = PIN_RENK[s.pin?.renk] || PIN_RENK.GRI;
              const r = (sec ? 9.5 : 7) * kat;
              return (
                <G key={`p-${s.id}`} onPress={() => onSaha(s)}>
                  <Circle cx={x} cy={y} r={18 * kat} fill="transparent" />
                  {benimGoster && s.benim ? <Circle cx={x} cy={y} r={r + 4.5 * kat} fill="none" stroke={renk.altin} strokeWidth={2.5 * kat} /> : null}
                  {sec ? <Circle cx={x} cy={y} r={r + 9 * kat} fill={c} opacity={0.18} /> : null}
                  <Circle cx={x} cy={y} r={r} fill={c} stroke="#FFFFFF" strokeWidth={2.2 * kat} />
                  {cokYakin || sec ? <SvgText x={x} y={y - r - 7 * kat} fontSize={11 * kat} fontWeight="700" fill={renk.lacivertKoyu} textAnchor="middle">{s.id}</SvgText> : null}
                </G>
              );
            })}
          </Svg>
        </Animated.View>
      ) : null}

      {/* Yakınlaştırma düğmeleri */}
      <View style={[{ position: "absolute", right: aralik.m, top: aralik.m, backgroundColor: renk.yuzey, borderRadius: kose.m }, golge]}>
        <IkonDugme ad="add" onPress={() => yakinlas(0.6)} etiket="Yakınlaştır" />
        <View style={{ height: 0.5, backgroundColor: renk.cizgi, marginHorizontal: 8 }} />
        <IkonDugme ad="remove" onPress={() => yakinlas(1.6)} etiket="Uzaklaştır" />
        <View style={{ height: 0.5, backgroundColor: renk.cizgi, marginHorizontal: 8 }} />
        <IkonDugme ad="scan-outline" onPress={sigdirVb} etiket="Sahalara sığdır" />
        <View style={{ height: 0.5, backgroundColor: renk.cizgi, marginHorizontal: 8 }} />
        <IkonDugme ad="globe-outline" onPress={() => setVb(oranla(TUM_TURKIYE, oran))} etiket="Tüm Türkiye" />
      </View>

      {/* Alt özet kartı + lejant */}
      <View style={{ position: "absolute", left: aralik.m, right: aralik.m, bottom: alt + aralik.m }} pointerEvents="box-none">
        <View style={[{ backgroundColor: renk.yuzey, borderRadius: kose.l, paddingHorizontal: aralik.m, paddingVertical: aralik.s }, golge]}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <Metin tur="govdeKalin">{sahalar.length}{sahalar.length !== toplam ? ` / ${toplam}` : ""} saha</Metin>
              <Metin tur="minik" renk={renk.metinIkincil} numberOfLines={1}>
                {[k.pinler.length ? `${k.pinler.length} kesin konum` : null, k.balonlar.length ? `${k.balonlar.reduce((a, g) => a + g.sahalar.length, 0)} yaklaşık (il)` : null,
                  k.konumsuz.length ? `${k.konumsuz.length} konumsuz` : null].filter(Boolean).join(" · ") || "Filtreye uyan saha yok"}
              </Metin>
            </View>
            <Pressable onPress={onListe} accessibilityRole="button" style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", backgroundColor: "#E6ECF4", borderRadius: kose.m, paddingHorizontal: 12, height: 38 }, pressed && { opacity: 0.8 }]}>
              <Ionicons name="list" size={17} color={renk.lacivert} />
              <Metin tur="kucukKalin" renk={renk.lacivert} style={{ marginLeft: 6 }}>Liste</Metin>
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 8, gap: 10 }}>
            {(lejant || PIN_SIRA.map((r) => ({ renk: r, ad: PIN_AD[r] }))).map((l) => (
              <View key={l.renk} style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: PIN_RENK[l.renk], marginRight: 5 }} />
                <Metin tur="minik" renk={renk.metinIkincil}>{l.ad}</Metin>
              </View>
            ))}
            {yaklasikLejant ? (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderStyle: "dashed", borderColor: renk.metinSoluk, marginRight: 5 }} />
                <Metin tur="minik" renk={renk.metinIkincil}>Yaklaşık (il)</Metin>
              </View>
            ) : null}
            {benimGoster ? (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: renk.altin, marginRight: 5 }} />
                <Metin tur="minik" renk={renk.metinIkincil}>Benim işim</Metin>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

// ── Alttan açılan paneller: saha detayı, il listesi, tüm liste, filtre seçimi ───────────────────────────────────────────────
function AltPanel({ panel, onKapat, f, setF, sec, suzulmus, tum, onSaha, navigation }) {
  const kenar = useSafeAreaInsets();
  return (
    <Modal visible={!!panel} transparent animationType="slide" onRequestClose={onKapat} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable style={{ ...absDolu, backgroundColor: "rgba(15,27,45,0.28)" }} onPress={onKapat} accessibilityLabel="Paneli kapat" />
        <View style={{ backgroundColor: renk.yuzey, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: "78%", paddingBottom: kenar.bottom + aralik.s }}>
          <View style={{ alignItems: "center", paddingTop: 8 }}><View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: renk.cizgiKoyu }} /></View>
          {panel?.tur === "saha" ? <SahaDetay s={panel.s} onKapat={onKapat} navigation={navigation} />
            : panel?.tur === "il" ? <SahaListesi baslik={`${panel.g.ad} · ${panel.g.sahalar.length} saha`} aciklama="Bu sahaların kesin koordinatı yok; il merkezinde yaklaşık gösteriliyor." sahalar={panel.g.sahalar} onSaha={onSaha} onKapat={onKapat} />
            : panel?.tur === "liste" ? <SahaListesi baslik={`Sahalar · ${suzulmus.length}`} aciklama={tum ? null : "Size atanmış işlerin sahaları"} sahalar={suzulmus} onSaha={onSaha} onKapat={onKapat} />
            : panel?.tur === "filtre" ? <FiltreSecimi alan={panel.alan} ad={panel.ad} f={f} setF={setF} secenekler={sec[panel.alan] || []} onKapat={onKapat} />
            : null}
        </View>
      </View>
    </Modal>
  );
}
const absDolu = { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 };

function PanelBaslik({ baslik, alt, onKapat, sag }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", paddingHorizontal: aralik.m, paddingTop: aralik.s, paddingBottom: aralik.s }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Metin tur="baslikM" style={{ fontWeight: "700" }} numberOfLines={2}>{baslik}</Metin>
        {alt ? <Metin tur="kucuk" renk={renk.metinIkincil} style={{ marginTop: 2 }}>{alt}</Metin> : null}
      </View>
      {sag}
      <IkonDugme ad="close" onPress={onKapat} etiket="Kapat" renkAdi={renk.metinIkincil} zemin={renk.yuzeyIkincil} />
    </View>
  );
}

function DurumNokta({ r, boyut = 10 }) {
  return <View style={{ width: boyut, height: boyut, borderRadius: boyut / 2, backgroundColor: PIN_RENK[r] || PIN_RENK.GRI }} />;
}

function SahaDetay({ s, onKapat, navigation }) {
  const [hata, setHata] = useState(null);
  const yer = [s.ilce, ilAdi(s.il || s.yaklasik_il), s.bolge && ilAdi(s.il || s.yaklasik_il) !== s.bolge ? `${s.bolge} bölgesi` : null].filter(Boolean).join(" · ");
  const adres = yolTarifiAdresi(s, Platform.OS);
  const yolTarifi = async () => { setHata(null); try { await Linking.openURL(adres); } catch (e) { setHata(hataMetni(e)); } };
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: aralik.s }}>
      <PanelBaslik baslik={s.id} alt={[s.saha_adi, yer].filter(Boolean).join(" — ")} onKapat={onKapat} />
      <View style={{ paddingHorizontal: aralik.m }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: renk.yuzeyIkincil, borderRadius: kose.tam, paddingHorizontal: 10, paddingVertical: 5 }}>
            <DurumNokta r={s.pin?.renk} />
            <Metin tur="etiket" style={{ marginLeft: 6 }}>{s.pin?.ad || PIN_AD[s.pin?.renk] || "Durum"}</Metin>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: s.konum ? renk.basariZemin : renk.uyariZemin, borderRadius: kose.tam, paddingHorizontal: 10, paddingVertical: 5 }}>
            <Ionicons name={s.konum ? "locate" : "location-outline"} size={14} color={s.konum ? renk.basari : renk.uyari} />
            <Metin tur="etiket" renk={s.konum ? renk.basari : renk.uyari} style={{ marginLeft: 5 }}>{s.konum ? "Kesin konum" : s.yaklasik_il ? "Yaklaşık · yalnız il" : "Konum yok"}</Metin>
          </View>
          {s.benim ? (
            <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: renk.altinZemin, borderRadius: kose.tam, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Ionicons name="person" size={13} color={renk.uyari} />
              <Metin tur="etiket" renk={renk.uyari} style={{ marginLeft: 5 }}>Size atanmış</Metin>
            </View>
          ) : null}
        </View>
        {s.adres ? <Metin tur="kucuk" renk={renk.metinIkincil} style={{ marginTop: aralik.s }}>{s.adres}</Metin> : null}

        <Metin tur="etiket" renk={renk.metinSoluk} style={{ marginTop: aralik.m, marginBottom: 6 }}>İŞLER ({(s.isler || []).length})</Metin>
        {(s.isler || []).map((x, i) => {
          const atama = (x.atamalar || []).find((a) => a.durum !== "TAMAMLANDI") || (x.atamalar || [])[0];
          return (
            <Pressable key={`${x.site_code}-${i}`} disabled={!atama} accessibilityRole={atama ? "button" : undefined}
              onPress={() => { onKapat(); navigation.navigate("IsDetay", { is: { id: atama.id, durum: atama.durum, kategori_ad: atama.kategori_ad, site_codes: [x.site_code] } }); }}
              style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", paddingVertical: 10, borderTopWidth: i ? 0.5 : 0, borderTopColor: renk.cizgi }, pressed && { opacity: 0.7 }]}>
              <View style={{ width: 4, alignSelf: "stretch", borderRadius: 2, backgroundColor: x.fiili?.renk || PIN_RENK[x.pin?.renk] || PIN_RENK.GRI, marginRight: aralik.s }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Metin tur="govdeKalin" numberOfLines={1}>{x.site_code}{x.site_type ? <Metin tur="kucuk" renk={renk.metinSoluk}>  {x.site_type}</Metin> : null}</Metin>
                <Metin tur="kucuk" renk={renk.metinIkincil} numberOfLines={2}>
                  {[x.durum_ad || x.pin?.ad, x.atanan_ekip, (x.taseronlar || []).join(", "), atama?.kategori_ad].filter(Boolean).join(" · ") || "—"}
                </Metin>
              </View>
              {atama ? <View style={{ flexDirection: "row", alignItems: "center" }}><Metin tur="etiket" renk={renk.lacivert}>İşi aç</Metin><Ionicons name="chevron-forward" size={18} color={renk.lacivert} /></View> : null}
            </Pressable>
          );
        })}

        {adres ? (
          <Buton baslik={s.konum ? "Yol tarifi al" : `${ilAdi(s.yaklasik_il || s.il)} — haritada aç`} ikon={s.konum ? "navigate" : "map-outline"} tur={s.konum ? "birincil" : "ikincil"}
            onPress={yolTarifi} style={{ marginTop: aralik.m }} erisimIpucu="Telefonun harita uygulamasında açılır" />
        ) : null}
        {!s.konum ? <Metin tur="minik" renk={renk.metinSoluk} style={{ marginTop: 8, textAlign: "center" }}>Sahanın kesin koordinatı henüz sistemde yok; yalnız il bilgisiyle gösteriliyor.</Metin> : null}
        {hata ? <Metin tur="kucuk" renk={renk.hata} style={{ marginTop: 8 }}>{hata}</Metin> : null}
      </View>
    </ScrollView>
  );
}

function SahaListesi({ baslik, aciklama, sahalar, onSaha, onKapat }) {
  const sirali = useMemo(() => [...sahalar].sort((a, b) => Number(!!b.benim) - Number(!!a.benim)
    || PIN_SIRA.indexOf(a.pin?.renk || "GRI") - PIN_SIRA.indexOf(b.pin?.renk || "GRI") || String(a.id).localeCompare(String(b.id), "tr")), [sahalar]);
  const [adet, setAdet] = useState(60);
  return (
    <>
      <PanelBaslik baslik={baslik} alt={aciklama} onKapat={onKapat} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: aralik.m, paddingBottom: aralik.s }}
        onScroll={(e) => { const n = e.nativeEvent; if (n.layoutMeasurement.height + n.contentOffset.y > n.contentSize.height - 400) setAdet((x) => Math.min(x + 60, sirali.length)); }}
        scrollEventThrottle={200}>
        {sirali.length === 0 ? <BosDurum ikon="search-outline" baslik="Filtreye uyan saha yok" /> : null}
        {sirali.slice(0, adet).map((s, i) => (
          <Pressable key={s.id} onPress={() => onSaha(s)} accessibilityRole="button" accessibilityLabel={`${s.id}, ${s.pin?.ad || ""}`}
            style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", minHeight: 56, borderTopWidth: i ? 0.5 : 0, borderTopColor: renk.cizgi }, pressed && { opacity: 0.7 }]}>
            <DurumNokta r={s.pin?.renk} boyut={12} />
            <View style={{ flex: 1, minWidth: 0, marginLeft: aralik.s }}>
              <Metin tur="govdeKalin" numberOfLines={1}>{s.id}{s.saha_adi ? <Metin tur="kucuk" renk={renk.metinSoluk}>  {s.saha_adi}</Metin> : null}</Metin>
              <Metin tur="kucuk" renk={renk.metinIkincil} numberOfLines={1}>
                {[ilAdi(s.il || s.yaklasik_il), s.pin?.ad, `${(s.isler || []).length} iş`, s.konum ? null : "yaklaşık"].filter(Boolean).join(" · ")}
              </Metin>
            </View>
            {s.benim ? <Ionicons name="person-circle" size={20} color={renk.altin} style={{ marginRight: 4 }} /> : null}
            <Ionicons name="chevron-forward" size={18} color={renk.metinSoluk} />
          </Pressable>
        ))}
      </ScrollView>
    </>
  );
}

function FiltreSecimi({ alan, ad, f, setF, secenekler, onKapat }) {
  const secili = f[alan] || [];
  const degistir = (d) => setF((x) => ({ ...x, [alan]: (x[alan] || []).includes(d) ? x[alan].filter((y) => y !== d) : [...(x[alan] || []), d] }));
  return (
    <>
      <PanelBaslik baslik={ad} alt={secili.length ? `${secili.length} seçili` : "Birden fazla seçebilirsiniz"} onKapat={onKapat}
        sag={secili.length ? <Pressable onPress={() => setF((x) => ({ ...x, [alan]: [] }))} hitSlop={8} style={{ height: 44, justifyContent: "center", marginRight: 8 }}><Metin tur="kucukKalin" renk={renk.lacivert}>Temizle</Metin></Pressable> : null} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: aralik.m }}>
        {secenekler.map((o, i) => {
          const sec = secili.includes(o.deger);
          return (
            <Pressable key={o.deger} onPress={() => degistir(o.deger)} accessibilityRole="checkbox" accessibilityState={{ checked: sec }}
              style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", minHeight: 50, borderTopWidth: i ? 0.5 : 0, borderTopColor: renk.cizgi }, pressed && { opacity: 0.7 }]}>
              {alan === "renk" ? <View style={{ marginRight: aralik.s }}><DurumNokta r={o.deger} boyut={12} /></View> : null}
              <Metin tur="govde" style={{ flex: 1 }} numberOfLines={1}>{o.ad || o.deger}</Metin>
              <Metin tur="kucuk" renk={renk.metinSoluk} style={{ marginRight: aralik.s }}>{o.adet}</Metin>
              <Ionicons name={sec ? "checkbox" : "square-outline"} size={22} color={sec ? renk.lacivert : renk.cizgiKoyu} />
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={{ paddingHorizontal: aralik.m, paddingTop: aralik.s }}>
        <Buton baslik="Haritada göster" onPress={onKapat} />
      </View>
    </>
  );
}
