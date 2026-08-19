import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Beyaz sayfa koruması (19.08.2026): bir bileşen render sırasında hata verirse
// React tüm ağacı söküyor ve kullanıcı bomboş ekran görüyordu. Artık hata
// mesajı + yeniden yükleme butonu gösterilir; destek için hata metni ekranda.
class HataSinir extends Component {
  constructor(props) { super(props); this.state = { hata: null }; }
  static getDerivedStateFromError(hata) { return { hata }; }
  componentDidCatch(hata, bilgi) { console.error("EKRAN HATASI:", hata, bilgi); }
  render() {
    if (!this.state.hata) return this.props.children;
    return (
      <div style={{ padding: "40px 24px", maxWidth: "680px", margin: "0 auto", fontFamily: "-apple-system,Segoe UI,Arial,sans-serif" }}>
        <div style={{ background: "#fff", border: "1.5px solid #fecaca", borderRadius: "14px", padding: "24px", boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}>
          <div style={{ fontSize: "18px", fontWeight: 800, color: "#b91c1c", marginBottom: "8px" }}>⚠️ Bu ekran açılamadı</div>
          <div style={{ fontSize: "14px", color: "#374151", lineHeight: 1.6, marginBottom: "16px" }}>
            Sayfa yüklenirken beklenmeyen bir hata oluştu. Aşağıdaki butonla sayfayı yenileyin;
            sorun sürerse hata metnini yöneticinize iletin.
          </div>
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "12px", fontSize: "12px", color: "#475569", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", marginBottom: "16px" }}>
            {String(this.state.hata?.message || this.state.hata)}
          </div>
          <button onClick={() => { try { localStorage.removeItem("son_sayfa"); } catch {} window.location.reload(true); }}
            style={{ padding: "10px 20px", background: "#1e3a5f", color: "#fff", border: "none", borderRadius: "9px", fontSize: "14px", fontWeight: 700, cursor: "pointer" }}>
            ↻ Sayfayı Yenile
          </button>
        </div>
      </div>
    );
  }
}

// Yeni sürüm çıktığında tarayıcıda kalan eski sayfa, silinmiş JS dosyasını
// isteyip beyaz ekranda kalıyordu. Bu hatayı yakalayıp bir kez otomatik
// yeniliyoruz (döngüye girmemek için oturumda tek sefer).
window.addEventListener("error", (ev) => {
  const msg = String(ev?.message || "");
  const dosyaHatasi = /Loading chunk|Failed to fetch dynamically imported|Importing a module script failed|error loading dynamically imported module/i.test(msg);
  if (!dosyaHatasi) return;
  try {
    if (sessionStorage.getItem("surum_yenilendi")) return;
    sessionStorage.setItem("surum_yenilendi", "1");
  } catch { return; }
  window.location.reload(true);
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HataSinir>
      <App />
    </HataSinir>
  </StrictMode>,
)
// build: 1781185471
