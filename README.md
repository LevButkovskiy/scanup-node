# scanup-node

Нода-исполнитель проверок [ScanUp](https://scanup.ru): опрашивает API ScanUp,
выполняет выданные проверки (`http_ping`, `icmp_ping`, `dns.v1`, `whois.v1`,
`ssl.v1`, `ping.v1`) и отправляет результаты обратно.

## Как это работает

1. Раз в `HEARTBEAT_INTERVAL_MS` нода шлёт heartbeat
   (`POST /nodes/heartbeat`) с версией и списком поддерживаемых типов
   проверок.
2. Держит `JOB_CONCURRENCY` независимых воркеров — каждый long-poll'ит
   `GET /nodes/jobs/next?wait=JOB_WAIT_MS` (backend держит соединение
   открытым до появления job'ы или истечения `wait`), выполняет ровно одну
   задачу и сразу спрашивает следующую.
3. Выполняет проверку по типу задачи: `http_ping` — HTTP-запрос к целевому
   URL с таймаутом из payload; `icmp_ping` — ICMP-монитор: ровно 3 пакета к хосту
   через системный `ping` (`-c 3`, ожидание ответа подогнано так, чтобы
   проверка уложилась в `timeoutMs`), в ответе число
   отправленных и полученных пакетов, потеря и RTT. Имя, которого нет
   (`ENOTFOUND`/`ENODATA`) или которое указывает на приватный адрес, — `done`
   с полем `error`; сбой самой ноды (не запустился `ping`, таймаут или отказ
   своего резолвера) — `failed`, бэкенд пишет «не выполнена»; `dns.v1` — DNS-запрос через указанный
   nameserver; `whois.v1` — WHOIS-запрос к домену; `ssl.v1` — проверка
   сертификата по TLS-хендшейку; `ping.v1` — ICMP ping через системный `ping`
   (в образе — `iputils`).
4. Отправляет результат в `POST /nodes/jobs/{jobId}/result`
   (`{ status: 'done', result: {...} }` или `{ status: 'failed', error }`).
   `failed` означает только сбой самой проверки. Если отправка не удалась
   (5xx, 429, сеть, таймаут), нода повторяет её, пока очередная попытка (с её таймаутом 10 с) укладывается
   в 60 с от первой, затем пишет в лог и
   ничего не шлёт: backend перевыдаёт job по истечении аренды.

Нода не хранит состояния и не имеет своей БД. Решение up/down принимает
backend — нода сообщает только факты.

## Отзыв ноды

Администратор ScanUp может отозвать ноду. После этого её токен становится
недействительным: API отвечает `401` на любой запрос, нода пишет в лог
`node token revoked — shutting down` и завершает работу с кодом `0`. Ретраев
нет: отзыв необратим, для новой ноды нужен новый токен.

С `--restart unless-stopped` Docker перезапускает контейнер и после штатного
выхода, поэтому отозванная нода будет стартовать и сразу останавливаться —
остановите её (`docker compose down`) или пропишите новый токен. Вариант
`--restart on-failure` перезапускает только после сбоев и такого цикла не
создаёт.

## Запуск

Самый простой способ поднять ноду — Docker, ничего собирать не нужно.

### Docker

```bash
docker run -d \
  --name scanup-node \
  --restart unless-stopped \
  --cap-drop=NET_RAW \
  -e SCANUP_API_URL=https://api.scanup.ru \
  -e SCANUP_NODE_TOKEN=<your-token> \
  ghcr.io/levbutkovskiy/scanup-node:latest
```

`--cap-drop=NET_RAW` забирает капабилити, которую Docker выдаёт контейнерам
по умолчанию. Ноде она не нужна: `ping.v1` работает через непривилегированный
ICMP ping-socket, который Docker разрешает своими дефолтами начиная с 20.10.

На старте нода один раз пингует `127.0.0.1`. Если ping не запускается или
loopback не отвечает (нет `iputils`, `net.ipv4.ping_group_range` не пускает
пользователя контейнера), нода пишет ERROR в лог и не объявляет `icmp_ping`:
иначе она брала бы ICMP-мониторы и сообщала, что все хосты лежат.
`ping.v1` при этом объявляется как раньше.
А raw-сокет — это возможность спуфить исходный IP и снифать трафик на
интерфейсе контейнера, поэтому лучше её не иметь: ноду разворачивают третьи
лица на своей сети.

Проверить, что нода работает:

```bash
docker logs -f scanup-node
```

Остановить и удалить:

```bash
docker stop scanup-node && docker rm scanup-node
```

### Docker Compose

В репозитории есть готовый `docker-compose.yml`. Скачайте его и `.env.example`
рядом, заполните `.env`:

```bash
curl -O https://raw.githubusercontent.com/LevButkovskiy/scanup-node/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/LevButkovskiy/scanup-node/main/.env.example
cp .env.example .env
# отредактируйте .env: впишите SCANUP_NODE_TOKEN
```

`docker-compose.yml`:

```yaml
services:
  scanup-node:
    image: ghcr.io/levbutkovskiy/scanup-node:latest
    restart: unless-stopped
    cap_drop:
      - NET_RAW
    environment:
      SCANUP_API_URL: ${SCANUP_API_URL:-https://api.scanup.ru}
      SCANUP_NODE_TOKEN: ${SCANUP_NODE_TOKEN}
      NODE_CITY: ${NODE_CITY:-}
      NODE_COUNTRY_CODE: ${NODE_COUNTRY_CODE:-}
      ALLOW_PRIVATE_TARGETS: ${ALLOW_PRIVATE_TARGETS:-}
```

Запуск и остановка:

```bash
docker compose up -d
docker compose logs -f
docker compose down
```

Нода 1.6.0 и новее шлёт в heartbeat город и страну, поэтому обновлять ноды
нужно после выкладки бэкенда с полем `location` в heartbeat: более старый
бэкенд ответит на такой heartbeat 400.

Обновление на новую версию образа:

```bash
docker compose pull
docker compose up -d
```

### Из исходников

```bash
npm ci
npm run build
SCANUP_API_URL=... SCANUP_NODE_TOKEN=... npm start
```

Локальная сборка образа:

```bash
docker build -t scanup-node .
docker run -e SCANUP_API_URL=... -e SCANUP_NODE_TOKEN=... scanup-node
```

## Переменные окружения

| Переменная              | Обязательна | Описание                                                         |
| ----------------------- | ----------- | ---------------------------------------------------------------- |
| `SCANUP_API_URL`        | да          | Базовый URL API ScanUp, без завершающего слэша                   |
| `SCANUP_NODE_TOKEN`     | да          | Токен ноды — выдаётся один раз при создании ноды в API           |
| `NODE_CITY`             | нет         | Город ноды (до 64 символов): пользователь видит его в проверках  |
| `NODE_COUNTRY_CODE`     | нет         | Код страны ISO 3166-1 alpha-2 заглавными, например `RU`          |
| `HEARTBEAT_INTERVAL_MS` | нет         | Интервал heartbeat, по умолчанию `30000`                         |
| `JOB_WAIT_MS`           | нет         | Long-poll бюджет `GET /nodes/jobs/next`, по умолчанию `25000`    |
| `JOB_CONCURRENCY`       | нет         | Число задач нода выполняет одновременно, по умолчанию `8`        |
| `ERROR_BACKOFF_MS`      | нет         | Пауза после сетевой ошибки при опросе, по умолчанию `10000`      |
| `ALLOW_PRIVATE_TARGETS` | нет         | `true` разрешает проверкам мониторов ходить во внутренние адреса |

`ALLOW_PRIVATE_TARGETS=true` нужен только для собственной ноды, которая
проверяет свою сеть. По умолчанию нода не открывает соединения с
loopback-, частными и link-local адресами (в том числе после редиректа и
подмены DNS) и отвечает `Private address is not allowed`. Переменная
действует только на проверки мониторов; инструменты (проверка сайта, SSL,
ping, DNS, WHOIS) блокируют такие адреса всегда. Допустимо лишь значение
`true`. При включении нода пишет предупреждение в лог. На публичных нодах не
включать.

Город и страна, заданные `NODE_CITY` и `NODE_COUNTRY_CODE`, нода сообщает при
каждом heartbeat. Если переменные убрать, бэкенд оставит последнее
сообщённое значение (`reported_city`): стереть его можно только заменой
значения, а скрыть — правкой администратора в админке.

`GET /nodes/jobs/next` — long-poll, а не короткий опрос: при пустой очереди
воркер не долбит эндпоинт, а ждёт внутри одного запроса до `JOB_WAIT_MS`.
Троттлинг на этом эндпоинте (backend) — по токену ноды, не по IP, и рассчитан
с большим запасом сверху реалистичной нагрузки при `JOB_CONCURRENCY` — растить
`JOB_CONCURRENCY` штатно, не оглядываясь на лимит. Heartbeat остаётся
интервальным (не long-poll), интервал по умолчанию согласован с его
лимитом (30/мин).

Раз в `HEARTBEAT_INTERVAL_MS` нода шлёт отдельным запросом `POST /nodes/metrics`
снимок загрузки за прошедший интервал: занятость воркеров, холостые опросы,
ответы 429 при сдаче результатов, CPU, throttling и память контейнера (cgroup v2;
без cgroup берутся показатели хоста с пометкой) и load average хоста. Бэкенд без
этого эндпоинта отвечает 404 — нода пишет об этом в лог один раз и продолжает
работать, порядок обновления бэкенда и ноды не важен.

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
