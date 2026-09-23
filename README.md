# TradingView MCP Server (Gratis / Unofficial)

MCP server yang narik data pasar dari TradingView **tanpa API berbayar**, dengan cara
menyambung langsung ke WebSocket internal yang dipakai website tradingview.com sendiri
(`wss://data.tradingview.com/socket.io/websocket`), sama seperti yang dipakai oleh
project open-source populer seperti `TradingView-API`.

## ⚠️ Penting — baca dulu

- Endpoint ini **tidak resmi/tidak didokumentasikan** oleh TradingView. Bisa berubah,
  dibatasi, atau diblokir kapan saja tanpa pemberitahuan.
- Berjalan secara anonim (tanpa login), jadi beberapa simbol bisa saja delayed atau
  tidak tersedia.
- Gunakan untuk keperluan pribadi/riset, dan tetap patuhi Terms of Service TradingView.
- Karena tanpa API key resmi, tidak ada SLA/garansi — kalau TradingView mengubah
  protokolnya, client ini mungkin perlu disesuaikan lagi.

## Tools yang tersedia

| Tool | Fungsi |
|---|---|
| `get_quote` | Snapshot harga real-time/delayed (last price, change, open/high/low, volume) |
| `get_historical` | Candle OHLCV historis (interval fleksibel: menit s/d bulanan) |
| `get_indicator` | Hitung RSI, MACD, SMA, atau EMA dari data historis |

Format simbol pakai prefix exchange, contoh:
- `NASDAQ:AAPL`
- `IDX:BBCA` (saham Indonesia)
- `BINANCE:BTCUSDT` (kripto)
- `FX:EURUSD` (forex)

Server ini berjalan sebagai **HTTP server** (bukan stdio biasa), supaya bisa
di-hosting online dan dipakai dari Claude di HP lewat URL — tidak perlu laptop.

## Deploy gratis dari HP (pakai Render.com + GitHub)

1. **Upload folder ini ke GitHub**
   - Buka github.com lewat browser HP → buat repo baru, misal `tradingview-mcp`.
   - Upload semua file di folder ini (bisa lewat tombol "Add file → Upload files"
     di halaman repo, drag semua file termasuk folder `src/`).

2. **Deploy ke Render (gratis)**
   - Buka [render.com](https://render.com) → daftar/login pakai akun GitHub.
   - Klik **New → Web Service** → pilih repo `tradingview-mcp` tadi.
   - Isi konfigurasi:
     - **Build Command**: `npm install && npm run build`
     - **Start Command**: `npm start`
     - **Instance Type**: Free
   - Klik **Create Web Service**. Tunggu build selesai (2–5 menit).
   - Setelah selesai, Render kasih URL publik, contoh:
     `https://tradingview-mcp-xxxx.onrender.com`

3. **Sambungkan ke Claude**
   - Di aplikasi Claude (HP) → **Settings → Connectors** (atau "Tambah connector").
   - Pilih "Custom connector" / "Add custom MCP server".
   - Masukkan URL: `https://tradingview-mcp-xxxx.onrender.com/mcp`
   - Simpan, lalu tools `get_quote`, `get_historical`, `get_indicator` bakal
     otomatis muncul saat kamu chat dengan Claude.

> Catatan: tier gratis Render bisa "tidur" kalau nggak dipakai beberapa menit,
> jadi request pertama setelah lama nganggur bisa agak lambat (10–30 detik)
> sebelum server bangun lagi. Ini normal untuk hosting gratis.

## Menjalankan lokal (opsional, kalau nanti punya laptop)

```bash
npm install
npm run build
npm start
```

Server akan jalan di `http://localhost:3000/mcp`.

## Contoh pemakaian setelah tersambung

- "Berapa harga BTC sekarang?" → memanggil `get_quote` dengan `BINANCE:BTCUSDT`
- "Ambil candle harian BBCA 100 terakhir" → `get_historical`
- "Hitung RSI 14 hari AAPL" → `get_indicator`

## Troubleshooting

- **"No quote/historical data received"** — cek format simbol (harus pakai prefix
  exchange, huruf besar, contoh `NASDAQ:AAPL` bukan `AAPL` saja).
- **Timeout terus** — kemungkinan endpoint TradingView sedang membatasi koneksi
  anonim; coba lagi beberapa saat, atau kurangi frekuensi request.
- **Build error module not found** — pastikan `npm install` sudah selesai sebelum
  `npm run build`.
