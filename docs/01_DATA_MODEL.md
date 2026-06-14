01_DATA_MODEL.md# docs/01_DATA_MODEL.md — Модель данных PROCLUSTER

> Прочитай этот файл перед фазами 1, 2, 3, 4, 12.
> Это единственный источник правды по схеме БД, агрегации и округлению.
> Любое отклонение от правил округления/сжатия = баг.

---

## 0. Принципы

- **Market data → ClickHouse.** Только агрегированные кластеры и снапшоты стакана.
- **Users / настройки → SQLite.** Лёгкая, 0 RAM на старте.
- **Черновая (live) агрегация + кэш last-N → Redis.**
- **Источник данных один: Binance.** WS trades stream (realtime) + https://data.binance.vision/ (история).
- **Никаких сырых тиков в ClickHouse долговременно** — храним уже сжатые кластеры. Сырьё живёт только в Redis на время сборки текущей свечи.

---

## 1. Базовые параметры тикеров (стартовые)

| Параметр | BTCUSDT FUTURES | BTCUSDT SPOT |
|---|---|---|
| Биржа | Binance Futures (USDⓈ-M) | Binance Spot |
| Шаг цены (tickSize) | 0.1 $ | 0.01 $ |
| Базовое сжатие (тиков на кластер) | 25 | 500 |
| Размер кластера в $ | 25 × 0.1 = **2.5 $** | 500 × 0.01 = **5 $** |
| Уровней сжатия | 10 (×1…×10) | 10 (×1…×10) |
| Ряд сжатий ($ на кластер) | 2.5 / 5 / 7.5 / 10 … 25 | 5 / 10 / 15 / 20 … 50 |
| Ряд сжатий (в тиках) | 25 / 50 / 75 … 250 | 500 / 1000 / 1500 … 5000 |
| TTL хранения | **1 год** | **3 года** |
| Снапшот стакана | раз в **1 минуту** | раз в **15 минут** |

> Эти значения — НЕ хардкод в логике. Они хранятся в таблице конфигурации тикеров (см. §6)
> и редактируются в админке. Код читает их оттуда. Новый тикер = новая строка конфига.

---

## 2. Правила округления объёмов (КРИТИЧНО)

Объём в каждой ячейке кластера округляется до **1 знака после запятой** перед записью в ClickHouse.

Метод округления: **round half up** (при ровной .5 — округляем вверх, от нуля).
Реализация: округление через десятичное представление (строковый разбор digit'ов), не через float-арифметику.

Примеры (обязательны как тест-кейсы):

| Сырой объём | Записываем | Пояснение |
|---|---|---|
| 5.1256 | 5.1 | d2=2 < 5 → truncate |
| 5.627 | 5.6 | d2=2 < 5 → truncate |
| 5.65 | 5.7 | d2=5 → round up |
| 0.0125 | 0 | d2=1 < 5 → truncate |
| 0.85 | 0.9 | d2=5 → round up |
| 0.75 | 0.8 | d2=5 → round up |
| 0.05 | 0.1 | d2=5 → round up |
| 0.15 | 0.2 | d2=5 → round up |
| 0.04 | 0 | d2=4 < 5 → truncate |
| 99.99 | 100.0 | d2=9 → round up + carry |

> Тип хранения: `Decimal(18, 1)` — для детерминизма.
> Округление выполняется ДО записи, на этапе агрегации. Не округлять при чтении.

---

## 3. Правила сжатия (биннинг по цене)

Кластер = диапазон цен размером `binSize = compression × tickSize`.

Граница бина для цены трейда:
```
binIndex = floor(price / binSize)
binPriceLow  = binIndex * binSize
binPriceHigh = binPriceLow + binSize
```
Цена-ключ кластера = `binPriceLow` (нижняя граница диапазона).

Пример FUTURES, сжатие 25 (binSize = 2.5 $):
- трейды по ценам 100.0 … 102.4 → попадают в бин с ключом **100.0**
- трейд 102.5 → бин **102.5**

Пример: «все тики, прошедшие в диапазон 100$–102.5$, агрегируются в 1 кластер» — это и есть бин [100.0, 102.5).

### Высшие уровни сжатия
Уровень N = базовое сжатие × N (N от 1 до 10).
Высшие уровни **получаем объединением** базовых кластеров (а не пересчётом из тиков):
```
кластеры уровня ×2 = слияние двух соседних базовых кластеров по цене,
суммирование bid/ask/volume, пересчёт POC/delta.
```
Объединение делать **на лету** при запросе ИЛИ кэшировать в Redis (см. §7).
Базовый уровень (×1) — единственный, что хранится в ClickHouse.

---

## 4. Интерпретация трейдов Binance (точность как ATAS/Tiger Trade)

Источник realtime: `aggTrade` или `trade` stream. **Используем `trade` stream** (тиковые сделки) для максимальной точности футпринта.

Поля трейда Binance:
- `p` — цена
- `q` — количество (объём в монетах)
- `T` — время сделки (trade time) — **используем именно его**, не event time
- `t` — tradeId
- `m` — isBuyerMaker

### Правило bid/ask (market-side)
```
isBuyerMaker == true  → агрессор = ПРОДАВЕЦ → это BID (продажа по рынку) → ячейка.bid += q
isBuyerMaker == false → агрессор = ПОКУПАТЕЛЬ → это ASK (покупка по рынку) → ячейка.ask += q
```
> bid = объём рыночных продаж, ask = объём рыночных покупок. Соответствует ClusterCell из PROCLUSTER3.
> **Единица объёма — base asset (BTC для BTCUSDT, ETH для ETHUSDT и т.д.), НЕ quote (USDT).**
> Поле `q` в Binance trade stream = количество монет базового актива.

### Обязательные требования к ingest (НЕ нарушать)
- ✔ Сортировать трейды по `tradeId` (t) перед агрегацией. Не доверять порядку прихода.
- ✔ Контроль непрерывности: если `tradeId` имеют разрыв — дозагрузить пропущенные через REST (`/fapi/v1/historicalTrades` / `/api/v3/historicalTrades`).
- ✔ Не терять пакеты при реконнекте WS: после реконнекта добрать пропуск по tradeId.
- ✔ Время свечи = trade time (`T`), округлённое вниз до границы ТФ.
- ✔ Дедупликация по tradeId (на случай повторной доставки).

---

## 5. Таймфреймы и агрегация по времени

| Рынок | Доступные ТФ |
|---|---|
| SPOT | 15m, 30m, 1h, 4h |
| FUTURES | 1m, 5m, 15m, 30m, 1h, 4h |

Сырьё с биржи агрегируется по ТФ:
- 1m ТФ — закрытие/запись раз в 1 минуту
- 1h ТФ — раз в час, и т.д.

> Храним каждый ТФ отдельными строками в ClickHouse (поле `timeframe`).
> Не пересчитываем старшие ТФ из младших на лету для записи — пишем каждый ТФ
> из живой агрегации (см. §7). Высшие ТФ можно достраивать из 1m при загрузке истории.

---

## 6. ClickHouse — схема таблиц

### 6.1 Конфигурация тикеров (управляется админкой)
```sql
CREATE TABLE IF NOT EXISTS ticker_config
(
    symbol                 LowCardinality(String),  -- 'BTCUSDT'
    market                 Enum8('spot'=1,'futures'=2),
    tick_size              Decimal(18, 8),           -- 0.1 / 0.01
    base_compression       UInt32,                   -- 25 / 500
    compression_levels     UInt8 DEFAULT 10,         -- кол-во уровней сжатия
    default_compression    UInt32 DEFAULT 25,        -- дефолтный уровень для UI
    ttl_days               UInt32,                   -- 365 / 1095
    dom_snapshot_seconds   UInt32 DEFAULT 60,        -- интервал снапшотов стакана
    enabled                UInt8 DEFAULT 1,
    updated_at             DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (symbol, market);
```

### 6.2 Кластеры — раздельные таблицы futures / spot
> Раздельные таблицы → собственный TTL у каждой. Хранение — отдельная строка на ячейку кластера.

```sql
-- FUTURES
CREATE TABLE IF NOT EXISTS clusters_futures
(
    symbol        LowCardinality(String),
    timeframe     LowCardinality(String),   -- '1m','5m','15m','30m','1h','4h'
    candle_time   DateTime,                 -- время открытия свечи (UTC), trade time
    price         Decimal(18, 1),           -- нижняя граница бина (binPriceLow)
    bid           Decimal(18, 1),           -- рыночные продажи (округл. до 0.1)
    ask           Decimal(18, 1),           -- рыночные покупки (округл. до 0.1)
    volume        Decimal(18, 1) MATERIALIZED bid + ask,
    is_poc        UInt8 DEFAULT 0,
    updated_at    DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(candle_time)
ORDER BY (symbol, timeframe, candle_time, price)
INDEX idx_price price TYPE minmax GRANULARITY 4
TTL candle_time + INTERVAL 365 DAY DELETE
SETTINGS index_granularity = 8192;

-- SPOT (структура идентична, отличается TTL)
CREATE TABLE IF NOT EXISTS clusters_spot
(
    symbol        LowCardinality(String),
    timeframe     LowCardinality(String),
    candle_time   DateTime,
    price         Decimal(18, 1),
    bid           Decimal(18, 1),
    ask           Decimal(18, 1),
    volume        Decimal(18, 1) MATERIALIZED bid + ask,
    is_poc        UInt8 DEFAULT 0,
    updated_at    DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(candle_time)
ORDER BY (symbol, timeframe, candle_time, price)
INDEX idx_price price TYPE minmax GRANULARITY 4
TTL candle_time + INTERVAL 1095 DAY DELETE
SETTINGS index_granularity = 8192;
```

> POC и delta свечи НЕ храним отдельно — считаются на чтении из строк ячеек
> (POC = ячейка с max volume; delta = Σ(ask − bid)). Это экономит место.
> `is_poc` можно проставлять при записи для ускорения, но источник истины — расчёт.

### 6.3 Снапшоты стакана (подготовка под heatmap, §9)
```sql
CREATE TABLE IF NOT EXISTS dom_snapshots_futures
(
    symbol      LowCardinality(String),
    snap_time   DateTime,            -- момент закрытия минуты
    price       Decimal(18, 1),      -- агрег. по base_compression (шаг 2.5$)
    bid_qty     Decimal(18, 1),
    ask_qty     Decimal(18, 1),
    updated_at  DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(snap_time)
ORDER BY (symbol, snap_time, price)
TTL snap_time + INTERVAL 90 DAY DELETE;     -- TTL уточняемый, на старт 90 дней

CREATE TABLE IF NOT EXISTS dom_snapshots_spot
(
    symbol      LowCardinality(String),
    snap_time   DateTime,            -- момент закрытия 15м
    price       Decimal(18, 1),      -- шаг 5$
    bid_qty     Decimal(18, 1),
    ask_qty     Decimal(18, 1),
    updated_at  DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(snap_time)
ORDER BY (symbol, snap_time, price)
TTL snap_time + INTERVAL 90 DAY DELETE;
```

> На старте history стакана НЕ пишем (только структуру готовим). Включение записи —
> отдельным флагом в админке, когда будем делать heatmap.

---

## 7. Redis — черновая агрегация и кэш

### 7.1 Live-агрегация текущей свечи
Ключи (пример FUTURES 1m):
```
agg:{market}:{symbol}:{tf}:{candle_time}  →  Hash { "<price>": "<bid>,<ask>" }
```
- Обновляется с КАЖДЫМ трейдом (инкремент bid/ask по бину).
- По закрытию интервала: округлить по §2, записать строки в ClickHouse, удалить ключ (или выставить короткий TTL).

### 7.2 Кэш последних N свечей (для быстрого открытия графика)
```
cache:{market}:{symbol}:{tf}  →  отсортированный список последних 700 свечей (готовые кластеры)
```
- При открытии графика фронт получает только эти ~700 свечей.
- Прокрутка дальше в прошлое → догрузка из ClickHouse по запросу (НЕ грузить весь год/месяц сразу).
- Обновляется при закрытии каждой свечи; при реконнекте фронта не грузим всё заново.

### 7.3 Кэш высших уровней сжатия (опционально)
```
cache:zip:{market}:{symbol}:{tf}:{level}  →  объединённые кластеры уровня ×N
```
- TTL короткий. Если нет в кэше — собрать на лету из базового уровня (§3).

---

## 8. ClickHouse — жёсткое ограничение логов (ОБЯЗАТЕЛЬНО)

ClickHouse по умолчанию пишет десятки ГБ системных логов. Сразу ограничить.

В `config.xml` / `users.xml` (через docker-compose volume):
```xml
<!-- Ограничить размер и время жизни системных таблиц -->
<query_log>
    <database>system</database>
    <table>query_log</table>
    <ttl>event_date + INTERVAL 3 DAY DELETE</ttl>
    <max_size_rows>1000000</max_size_rows>
</query_log>
<!-- Аналогично для: query_thread_log, part_log, trace_log,
     metric_log, asynchronous_metric_log, text_log, session_log -->

<!-- Логи в файл — ротация -->
<logger>
    <level>warning</level>
    <size>100M</size>
    <count>3</count>
</logger>
```
Рекомендации:
- `metric_log`, `asynchronous_metric_log`, `trace_log`, `text_log` — **отключить** или TTL 1–3 дня.
- Уровень логирования — `warning` (не `trace`/`debug`).
- Раз в сутки cron: `SYSTEM FLUSH LOGS` не нужен; полагаться на TTL.
- Контролировать размер `system.*` таблиц через админку (метрика).

---

## 9. Стакан (DOM) — снапшоты и live

### 9.1 Live (на старте — только это)
- Источник: Binance depth stream (`@depth` / partial book).
- Диапазон: ±5% от текущей цены.
- Агрегация по `base_compression` тикера (шаг плотности = binSize): futures 2.5$, spot 5$.
- Обновление на фронт: 1 раз в секунду.
- Лента стакана прокручивается вверх/вниз; при бездействии >1с — рецентрировать на текущей цене.

### 9.2 Снапшоты (структура готова, запись позже)
- point-in-time: берём мгновенное состояние стакана в **момент закрытия интервала**.
- FUTURES — раз в 1 минуту (последняя секунда минуты), привязка к закрытию свечи.
- SPOT — раз в 15 минут.
- Агрегация по base_compression (как live).
- Пишем в `dom_snapshots_*` (когда включим флагом).

---

## 10. SQLite (краткая ссылка, детали — отдельный docs)

Users / настройки / тарифы / пресеты Cluster Search → SQLite (см. docs/04_TIERS.md и будущий docs/06_AUTH.md).
В этом файле — только market data.

---

## 11. Чек-лист готовности модели данных
- [ ] ticker_config заполнен для BTCUSDT futures и spot
- [ ] clusters_futures / clusters_spot созданы с правильным TTL (365 / 1095)
- [ ] Округление до 0.1 покрыто тестами (кейсы из §2)
- [ ] Биннинг по цене покрыт тестами (кейсы из §3)
- [ ] isBuyerMaker → bid/ask проверено (§4)
- [ ] Сортировка по tradeId + контроль разрывов + дедуп
- [ ] Redis live-агрегация инкрементится по трейдам
- [ ] Кэш last-700 работает, догрузка из CH по запросу
- [ ] Логи ClickHouse ограничены TTL + ротация файлов
- [ ] dom_snapshots_* созданы (запись выключена флагом)
