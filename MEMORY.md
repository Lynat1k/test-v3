# MEMORY.md — PROCLUSTER (project memory)

> Стартовая конституция проекта. Читается в начале каждой сессии.
> Детали — в docs/. Здесь только то, что MiMo обязан держать в голове всегда.

## 0. Что это
Онлайн-сервис кластерных (footprint) графиков крипты уровня ATAS/Exocharts.
- chart.procluster.online — терминал (графики, стакан, индикаторы)
- procluster.online — лендинг-презентация
Стиль: тёмная тема по умолчанию, liquid glass, переключатель dark/light. Языки RU/EN.

## 1. Жёсткие правила (НЕ нарушать)
- Бэкенд ТОЛЬКО Go. Один бинарник + горутины. НЕ микросервисы.
- Движок графика ТОЛЬКО HTML5 Canvas 2D. НЕ TradingView Lightweight Charts.
- Market data → ClickHouse. Users/настройки → SQLite. Live-агрегация/кэш → Redis.
- НИКАКИХ фейковых/сгенерированных данных. Источник один: Binance
  (trades stream realtime + data.binance.vision для истории).
- Деплой: docker-compose на VPS (4 CPU / 8GB RAM / 75GB NVMe). Беречь RAM.
- Reverse-proxy: Caddy (авто-HTTPS обоих доменов + rate-limit).
- Формат фронт↔бэк: JSON (MessagePack только если будет bottleneck).
- Все важные изменения коммитятся (CI/CD автодеплой при push).
- Фронту НЕ доверяем: лимиты/роли/доступ решает бэкенд.
- Heatmap (тепловая карта) СЕЙЧАС НЕ делаем — только структура БД под неё.

## 2. UI-источник (PROCLUSTER3)
Дизайн/верстку/компоненты берём из репо PROCLUSTER3 (React 19 + Vite + Tailwind 4).
ПЕРЕНОСИМ: ClusterChart.tsx (движок), Header, DOMSidebar (без торговой панели),
IndicatorsModal, UserProfile, AdminPanel (без симулятора), Sidebar/иконки/логотипы.
УДАЛЯЕМ: dataGenerator.ts, server.ts (Express), auth/mockAuth.ts, @google/genai,
любые хардкод-данные по объёмам/стакану/ленте.
Движок НЕ переписываем — адаптируем под реальные данные (см. docs/02).

## 3. Структура монорепо
```
procluster/
├── MEMORY.md, mimocode.json
├── docs/ (00_GLOSSARY,01_DATA_MODEL,02_CHART_ENGINE,03_CLUSTER_SEARCH,04_TIERS,05_SECURITY)
├── docker-compose.yml        # clickhouse + redis + backend + caddy
├── backend/                  # Go: ingest, aggregate, store, cache, ws, api, auth, tiers, admin
├── frontend-chart/           # chart.procluster.online (порт PROCLUSTER3)
└── frontend-landing/         # procluster.online
```

## 4. Данные и сжатие (детали → docs/01_DATA_MODEL.md)
- BTCUSDT FUTURES: тик 0.1$, база 25 тиков (=2.5$), TTL 1 год, снапшот DOM 1м.
- BTCUSDT SPOT: тик 0.01$, база 500 тиков (=5$), TTL 3 года, снапшот DOM 15м.
- До 10 уровней сжатия, кратных базе. Базовый уровень хранится, высшие — слияние.
- Объёмы округлять до 0.1 (5.1256→5.1; 0.0125→0; 0.85→0.8). Decimal(18,1).
- isBuyerMaker→bid/ask; сортировка по tradeId; дедуп; контроль разрывов; trade time.
- Кэш: при открытии графика только последние ~700 свечей; дальше догрузка по запросу.
- Параметры тикеров — в ticker_config (БД), не хардкод. Новый тикер = строка конфига.

## 5. Движок (детали → docs/02_CHART_ENGINE.md)
- rAF + dirty-флаг; WS-апдейты батчить раз в кадр; цель 60 FPS.
- Зум колесом к курсору; SHIFT+колесо=вертикаль; CTRL+колесо=горизонталь.
- Auto: <70 кластера, 70–300 футпринт, ≥300 японские.
- Диагональный имбаланс ATAS (>300%). Workspace 1/2 графика + разделитель.
- Палитры (красно-зелёная / бело-серая). Панель объектов рисования слева.

## 6. Cluster Search (детали → docs/03_CLUSTER_SEARCH.md)
Базовый индикатор, включён по умолчанию для всех. Считается на бэке (для realtime + TG).
Дефолтный пресет меняют только VIP/Admin, пресет кэшируется в Redis.

## 7. Тарифы (детали → docs/04_TIERS.md)
Guest/Free/Pro/VIP/Admin. История: гость 1нед, Free 6мес, Pro больше, VIP вся.
Лимиты в tier_limits (SQLite), редактируются в админке. Проверяет бэкенд.

## 8. Безопасность (детали → docs/05_SECURITY.md)
SSH ключи+fail2ban+без пароля; Caddy rate-limit (анти-брутфорс/DDoS); CORS только наши домены;
параметризованные запросы; argon2/bcrypt; admin-эндпоинты под role=admin.
Аудит — обязательная фаза 14 (режим plan).

## 9. Стек (подтверждён)
Go (1 бинарник+горутины), ClickHouse, SQLite, Redis, Docker Compose, Caddy.
JSON на старте. Live DOM на старте (без history). Старт: 2 символа (BTCUSDT fut + spot).
Прокси для Binance: `BINANCE_PROXY` env — `socks5://host:port` (golang.org/x/net/proxy) или `http://host:port` (standard Go proxy). Если пусто — direct.

## 10. Статус фаз (дополняется автоматически)
- [x] 0 Скелет монорепо + docker-compose + перенос PROCLUSTER3 + чистка фейков [build]
- [x] 1 Схема ClickHouse + правила агрегации (docs/01) [build] ✅ DONE
- [x] 2 Ingest Binance WS + Redis live-агрегация [compose] ✅ DONE (live-tested)
- [x] 3 History loader (data.binance.vision) + агрегация + округление [build] ✅ DONE
- [x] 4 REST API: candles(last-700+догрузка), DOM live, fear&greed [build] ✅ DONE
- [x] 5 WS-хаб на фронт (батч 100-500ms) [build] ✅ DONE
- [~] 6 Адаптация движка + интерактив [compose] ЧАСТИЧНО DONE
  - ✅ REST /api/candles + WS hub работают
  - ✅ 1 WS-соединение на (symbol, market), агрегаторы для всех ТФ
  - ✅ ticker_config дедупликация (idempotent seed + FINAL)
  - ✅ BINANCE_PROXY: socks5:// и http:// через Happ
  - ✅ WS singleton (React 19 StrictMode safe), per-subscription callbacks
  - ✅ Google Fonts в <link> (CSS @import fix)
  - ⚠️ ГЛАВНЫЙ БАГ: realtime не отображается на графике. Сервер шлёт broadcast update (лог: "broadcast: key=futures:BTCUSDT:1m:125 cells=N clients=1"), НО свеча не двигается. Обрыв на клиенте при приёме/отрисовке update.
  - 🔍 DIAGNOSTIC (2026-06-15): Код Go-хаба проверен — везде `*Client` (указатели), копий по значению нет. WritePump запущен на том же объекте, что и в subs map. Логи `[WS] broadcast -> client send <addr>` И `[WS] writePump WRITE to <addr>` появляются каждые ~200ms с совпадающими адресами. Значит проблема НЕ в Go-бэкенде — обрыв на стороне клиента (wsClient.ts парсинг, newline-delimited split, или CORS/origin).
  - ⚠️ График показывает старые свечи (loadhistory), новые за сегодня не появляются. REST отдаёт старый диапазон.
- [ ] 7 Auth: JWT + Google OAuth (SQLite) [build]
- [ ] 8 Тарифы + ограничения истории/индикаторов [build]
- [ ] 9 Cluster Search (docs/03) [compose]
- [ ] 10 Профиль + сохранение настроек [build]
- [x] 11 Админка: загрузка истории, метрики, тикеры, дефолты сжатия, логи [build] ✅ DONE (fixes: non-blocking CPU poller, SSE progress+heartbeat, ring-buffer log interceptor, disk metrics, SVG graphs)
  - ⚠️ Known issue: futures gap-fill через публичный aggTrades возвращает 0 trades: WS-поток читает @trade (обычные tradeId), а aggTrades адресуется по aggTradeId — нумерация не совпадает. spot gap-fill работает. futures gap-fill вызывается только при разрыве WS, который сейчас происходит из-за нестабильного локального прокси. ПРОВЕРИТЬ на VPS (Гонконг, прямое соединение без прокси) — разрывов почти не будет. Если на VPS разрывы останутся — решение: дозагружать futures aggTrades по startTime/endTime (timestamp границ gap) с фильтрацией по полям f/l, либо перевести futures WS-поток на @aggTrade.
- [ ] 12 Структура снапшотов стакана (под heatmap, без рендера) [plan→build]
- [ ] 13 Лендинг procluster.online [build]
- [ ] 14 Аудит безопасности + хардненинг [plan]
- [ ] 15 CI/CD автодеплой [build]

## 11. Уроки из live-тестирования (Phase 2)
- Go JSON case-insensitive matching: `json:"e"` matches BOTH `"e"` and `"E"` в JSON. Binance шлёт `"e":"trade"` и `"E":1781413832380` (число). Решение: `map[string]json.RawMessage` для точного маппинга ключей.
- `clickhouse-go/v2` не принимает `float64` в `Decimal(18,1)` колонки. Используем `shopspring/decimal`.
- Unexported поля ( lowercase `t`) не маппятся `json.Unmarshal`. Все JSON-поля должны быть exported.
- INDEX в ClickHouse CREATE TABLE: синтаксис требует правильного порядка (INDEX до TTL).

## 12. Уроки из history loading (Phase 3)
- **data.binance.vision CSV format**: comma-delimited, NO pipe as README says. URL: `data/futures/um/daily/trades/{SYMBOL}/{SYMBOL}-trades-{DATE}.zip` (futures), `data/spot/daily/trades/{SYMBOL}/{SYMBOL}-trades-{DATE}.zip` (spot). **Futures CSV**: header row + 6 cols (`id,price,qty,quote_qty,time,is_buyer_maker`). **Spot CSV**: NO header + 7 cols (`id,price,qty,quote_qty,time,is_buyer_maker,is_best_match`). Spot time is microseconds (>1e15 → /1000).
- **Trades have continuous tradeId**: Binance trades (NOT aggTrades) have sequential IDs. Gaps = real data loss → must be logged.
- **ReplacingMergeTree idempotency**: Re-INSERTing same data creates temporary duplicates. Deduplication happens on background merge. Queries use `FINAL` keyword for correct results.
- **Memory-efficient streaming**: Process 1.8M trades/day without loading everything into memory — CSV parsed line-by-line, per-candle aggregators created lazily.

## 13. Уроки из WS-хаба (Phase 5)
- **Backpressure via buffered channel**: Use `select { case c.send <- data: default: c.Close() }` — non-blocking send with immediate disconnect on buffer full. One goroutine per tick, not per client.
- **Single ticker goroutine**: Hub uses one `time.Ticker` at 200ms for all subscriptions. Iterates unique sub keys, reads Redis, broadcasts. No goroutine-per-client timer.
- **Subscription key encoding**: `market:symbol:tf:compression` as flat string for map key. Parse back with colon-split from the right (compression is last, has no colons in value).
- **CandleCloser callback**: Added `SetOnClose(fn CloseFunc)` to notify WS hub on candle close. Callback runs in a goroutine to not block the closer loop.
- **gorilla/websocket already in go.mod**: No new dependencies needed for WS hub.
- **One WS connection per (symbol, market), NOT per timeframe**: Binance trade stream for a pair feeds ALL timeframes. Created WSClient with `[]TFAggregator` map — one WS connection, multiple aggregators. CandleCloser takes aggregator directly, not WSClient. Result: 2 connections for BTCUSDT (1 futures + 1 spot), not 10.
- **ClickHouse ticker_config idempotent seed**: Migration INSERT runs every restart → duplicates. Fix: (1) ApplyMigrations skips INSERT if table has rows, (2) QueryTickerConfigs uses `SELECT ... FINAL` for ReplacingMergeTree dedup, (3) Go-level dedup by (symbol, market) before starting WS. OPTIMIZE TABLE FINAL for cleanup.

## 14. Уроки из адаптации движка (Phase 6)
- **Backend WS hub protocol**: Client sends `{"action":"subscribe","symbol":"...","market":"...","tf":"...","compression":N}`, server responds with `{"type":"update","candle":{...}}` every 200ms and `{"type":"close","candle":{...}}` + `{"type":"open","candle_time":...}` on candle close. Messages may be batched with `\n` separator in a single WebSocket frame.
- **Backend REST contract**: `GET /api/candles?symbol=&market=&tf=&compression=&before=&limit=` returns `{"ok":true,"data":{"candles":[...],"history_limited":bool}}`. The `before` param is unix seconds for scroll-back.
- **Frontend already has all interactive features**: zoom to cursor, SHIFT/CTRL wheel, Auto mode, palettes, drawing tools, workspace split — these just needed real data connected.
- **Direct Binance WS → Backend WS hub**: Eliminates client-side aggregation, keeps all trade processing server-side. Client just receives pre-computed ClusterCandle updates.
- **Backend candle fields**: `time` (unix seconds) maps to frontend `timestamp` (unix ms). Cells include `isPoc`, `isBuyImbalance`, `isSellImbalance` computed server-side with 300% diagonal ratio.
- **CORS whitelist**: Full origin matching (scheme://host:port), not just host. Configurable via `CORS_ALLOWED_ORIGINS` env (comma-separated). Empty = dev+production defaults. Shared `api.IsOriginAllowed()` used by both REST corsMiddleware and WS CheckOrigin.
- **React 19 StrictMode + WebSocket**: StrictMode mounts effects twice in dev. Solution: module-level singleton map (`singletons` by URL). `getOrCreateWsClient(url, config)` returns existing client or creates new one. `updateConfig()` updates callbacks on remount. Cleanup only clears ref — does NOT destroy socket. Socket survives double-mount. Reconnect on real drops via `onclose`. Multiple subscriptions per connection: `activeSubs` Map tracks all active (symbol,market,tf,compression) combos; on reconnect re-sends all. Per-subscription callbacks: `subCallbacks` Map routes updates by (symbol,market,tf,compression) from server message to correct chart buffer.
- **Candle OHLC fix**: ClickHouse schema now includes `open_price`/`close_price` columns (ALTER TABLE IF NOT EXISTS for existing deployments). Aggregator tracks first/last trade prices. QueryCandles reads real OHLC from DB and reverses DESC→ASC order. buildCandle in hub.go uses `Close = cell.Price` (not `+compression*tickSize`) for consistency with REST.
