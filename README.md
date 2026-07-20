# scanup-node

Нода-исполнитель проверок [ScanUp](https://scanup.ru): опрашивает API ScanUp,
выполняет выданные проверки (сейчас — `http_ping`) и отправляет результаты
обратно.

## Как это работает

1. Раз в `HEARTBEAT_INTERVAL_MS` нода шлёт heartbeat
   (`POST /nodes/heartbeat`) с версией и списком поддерживаемых типов
   проверок.
2. В цикле опрашивает `GET /nodes/jobs/next`; если задач нет — пауза
   `POLL_INTERVAL_MS`.
3. Для `http_ping` выполняет HTTP-запрос к целевому URL с таймаутом из
   payload и замеряет время ответа.
4. Отправляет результат в `POST /nodes/jobs/{jobId}/result`
   (`{ status: 'done', result: { statusCode, responseTimeMs } }` или
   `{ status: 'failed', error }`).

Нода не хранит состояния и не имеет своей БД. Решение up/down принимает
backend — нода сообщает только факты.

## Запуск

```bash
npm ci
npm run build
SCANUP_API_URL=... SCANUP_NODE_TOKEN=... npm start
```

### Docker

Готовый образ публикуется в GitHub Container Registry при пуше в `main`
(тег `edge`) и при релизном теге `vX.Y.Z` (теги `X.Y.Z`, `X.Y`, `latest`):

```bash
docker run \
  -e SCANUP_API_URL=... \
  -e SCANUP_NODE_TOKEN=... \
  ghcr.io/levbutkovskiy/scanup-node:latest
```

Локальная сборка:

```bash
docker build -t scanup-node .
docker run -e SCANUP_API_URL=... -e SCANUP_NODE_TOKEN=... scanup-node
```

## Переменные окружения

| Переменная              | Обязательна | Описание                                                             |
| ----------------------- | ----------- | -------------------------------------------------------------------- |
| `SCANUP_API_URL`        | да          | Базовый URL API ScanUp, без завершающего слэша                       |
| `SCANUP_NODE_TOKEN`     | да          | Токен ноды — выдаётся один раз при создании ноды в API               |
| `NODE_LOCATION`         | нет         | Человекочитаемая метка локации (только для логов)                    |
| `HEARTBEAT_INTERVAL_MS` | нет         | Интервал heartbeat, по умолчанию `30000`                             |
| `POLL_INTERVAL_MS`      | нет         | Пауза между опросами пустой очереди, по умолчанию `3000`             |
| `ERROR_BACKOFF_MS`      | нет         | Пауза после сетевой ошибки при опросе, по умолчанию `10000`          |

Интервалы по умолчанию согласованы с rate-лимитами backend'а
(30/мин на heartbeat, 60/мин на `jobs/next`).

Токен передаётся заголовком `Authorization: Bearer <token>`.

## Релизы

Версия в `package.json`, git-тег и Docker-тег синхронизируются автоматически
через [semantic-release](https://semantic-release.gitbook.io/): при пуше в
`main` он разбирает историю коммитов по
[Conventional Commits](https://www.conventionalcommits.org/), сам решает
patch/minor/major, коммитит версию и `CHANGELOG.md`, создаёт git tag и GitHub
Release. Тег вида `vX.Y.Z` запускает публикацию Docker-образа с этой же
версией (см. `## Docker` выше) — вручную версию нигде проставлять не нужно.

Сообщения коммитов обязаны следовать Conventional Commits
(`fix: ...`, `feat: ...`, `feat!: ...` / `BREAKING CHANGE: ...` для мажора и
т.д.) — иначе semantic-release не поймёт, какой релиз делать. Это проверяется
локально хуком husky (`commit-msg`, ставится сам после `npm ci` через
`prepare`) и повторно в CI (`commitlint` на каждый PR) — локальная проверка
обходима (`--no-verify`, PR из веба), CI-проверка нет.

## Лицензия

[AGPL-3.0](./LICENSE). Модификации, которые вы распространяете или
предоставляете как сервис третьим лицам, обязаны публиковаться под той же
лицензией. Для использования на условиях, несовместимых с AGPL (закрытая
модификация, встраивание в проприетарный сервис), обращайтесь за
коммерческой лицензией к ScanUp.
