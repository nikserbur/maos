# Предустановленные карты уровня «Мир»

Карта работает без внешних серверов: всё нужное лежит здесь и отдаётся интерфейсом как статические файлы.

| Каталог / файл | Что это | Источник и лицензия |
|---|---|---|
| `tiles/{z}/{x}/{y}.mvt.gz` | Векторные тайлы (MVT, gzip): z0–6 — Урал и окрестности, z7–8 — район площадок | © участники OpenStreetMap, ODbL 1.0; сборка Protomaps (см. `meta.json`) |
| `fonts/` | Глифы шрифтов Noto Sans (обычный, полужирный, курсив) | SIL Open Font License 1.1 (protomaps/basemaps-assets) |
| `sprites/` | Значки стиля тёмного и светлого | protomaps/basemaps-assets |
| `routes.json` | Дорожные маршруты между площадками демо-холдинга, рассчитанные заранее | OSRM по данным OpenStreetMap, ODbL 1.0 |
| `meta.json` | Версия сборки, масштабы, границы региона | — |

Стиль карты (слои) — `src/features/plant-scene/worldmap2d/styles/*.json`, библиотека @protomaps/basemaps (BSD-3).

Обновление карт (нужен интернет только на этом шаге):

```bash
cd scripts/maps && npm install && npm run build
```
