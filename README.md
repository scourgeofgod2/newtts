# metinseslendirme.com

> Türkçe, İngilizce ve İspanyolca metin seslendirme aracı.  
> Fish Audio altyapısıyla çalışan, Node.js tabanlı TTS proxy + statik site.

---

## Proje Hakkında

**metinseslendirme.com**, "metin seslendirme" ve "yazıyı sese çevirme" anahtar kelimeleri için Google organik trafiği çekmek amacıyla tasarlanmış uydu (satellite) bir web sitesidir. Siteye gelen kullanıcılar ücretsiz olarak 500 karaktere kadar metin seslendirebilir; daha gelişmiş özellikler için ana platform **[yankitr.com](https://yankitr.com)**'a yönlendirilir.

---

## Ana Platform: Yankı (yankitr.com)

**[Yankı](https://yankitr.com)**, Türkiye merkezli gelişmiş bir yapay zeka platformudur.

| Özellik | Detay |
|---|---|
| 🎙️ Premium Sesler | 130+ gerçekçi insan sesi |
| 🌐 Dil Desteği | 20'den fazla dil |
| 🎭 Duygu Analizi | Fısıltı, heyecan, coşku efektleri |
| 📥 İndirme | Yüksek kaliteli MP3 / WAV |
| 💰 Fiyat | 89₺/ay'dan başlayan planlar, 1.000 kredi ücretsiz başlangıç |

---

## Teknik Yapı

```
metinseslendirme.com/
├── server.js              ← Express proxy — Fish Audio API key sunucuda saklanır
├── package.json           ← Node.js bağımlılıkları (express, dotenv)
├── Dockerfile             ← Coolify / Docker deploy
├── .env.example           ← Ortam değişkenleri şablonu
├── .gitignore
├── index.html             ← SEO + PWA + JSON-LD schema
├── style.css              ← Neobrutal design system
├── script.js              ← Fish Audio TTS istemcisi
├── sitemap.xml
├── robots.txt
├── manifest.webmanifest   ← PWA
└── llms.txt               ← LLM indeksleyici için
```

---

## Kurulum

### 1. Bağımlılıkları yükle

```bash
npm install
```

### 2. Ortam değişkenlerini ayarla

```bash
cp .env.example .env
```

`.env` dosyasını düzenle:

```
FISH_API_KEY=senin_fish_audio_api_keyin
PORT=3000
```

> Fish Audio API key edinmek için: [fish.audio](https://fish.audio)

### 3. Ses ID'lerini güncelle

`script.js` içindeki `VOICES` dizisinde bulunan `id` değerlerini,  
fish.audio hesabından aldığın gerçek voice ID'lerle değiştir.

### 4. Sunucuyu başlat

```bash
npm start
# veya geliştirme modunda (hot reload):
npm run dev
```

Uygulama `http://localhost:3000` adresinde çalışır.

---

## Deploy (Coolify)

1. Bu repoyu Coolify'a bağla
2. **Environment Variables** bölümüne ekle:
   - `FISH_API_KEY` = Fish Audio key
   - `PORT` = 3000
3. Build type: **Dockerfile**
4. Deploy et — `/api/health` endpoint'i healthcheck için kullanılır

---

## Lisans

MIT — Ticari kullanım serbesttir.  
Backlink bırakmak güzeldir: [yankitr.com](https://yankitr.com) 🎙️