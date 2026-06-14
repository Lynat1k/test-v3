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

## 10. Статус фаз (дополняется автоматически)
- [x] 0 Скелет монорепо + docker-compose + перенос PROCLUSTER3 + чистка фейков [build]
- [x] 1 Схема ClickHouse + правила агрегации (docs/01) [build] ✅ DONE
- [x] 2 Ingest Binance WS + Redis live-агрегация [compose] ✅ DONE (live-tested)
- [x] 3 History loader (data.binance.vision) + агрегация + округление [build] ✅ DONE
- [ ] 4 REST API: candles(last-700+догрузка), DOM live, fear&greed [build]
- [ ] 5 WS-хаб на фронт (батч 100-500ms) [build]
- [ ] 6 Адаптация движка + интерактив (zoom/SHIFT/CTRL/auto/workspace) [compose]
- [ ] 7 Auth: JWT + Google OAuth (SQLite) [build]
- [ ] 8 Тарифы + ограничения истории/индикаторов [build]
- [ ] 9 Cluster Search (docs/03) [compose]
- [ ] 10 Профиль + сохранение настроек [build]
- [ ] 11 Админка: загрузка истории, метрики, дефолты [build]
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
```
