# 🎲 TAVLA ONLINE

Professional multiplayer backgammon with WebSocket real-time sync.

## Özellikler
- 🌐 Gerçek online multiplayer (WebSocket)
- 🤖 Bilgisayara karşı (3 zorluk: Kolay / Orta / Zor)
- 🎯 Tam tavla kuralları (bar, bearing off, doubles, mars, tavla)
- 🎲 3D zarlar, gerçekçi ahşap pul görseli
- 🔊 Fizik tabanlı ses efektleri

## Render'a Deploy

### 1. GitHub'a Yükle
```bash
git init
git add .
git commit -m "tavla online"
git remote add origin https://github.com/KULLANICI/tavla.git
git push -u origin main
```

### 2. Render'da Yeni Servis
1. https://render.com → "New Web Service"
2. GitHub reponuzu bağlayın
3. Ayarlar otomatik gelir (render.yaml'dan)
4. "Deploy" — 2 dakika sonra hazır!

### 3. Oynayın
- Render size bir URL verir: `https://tavla-online-xxxx.onrender.com`
- Bu URL'yi arkadaşınızla paylaşın
- Biri "Oda Oluştur", diğeri oda kodunu girer → Oyun başlar!

## Yerel Test
```bash
npm install
npm start
# http://localhost:3000 aç
# İki sekme aç, farklı oyuncu adları gir, oyna!
```

## Teknik
- Node.js + Express (static dosya sunumu)
- ws (WebSocket server)
- Saf HTML/CSS/Canvas (framework yok)
- Render free tier ile çalışır (~750 saat/ay)
