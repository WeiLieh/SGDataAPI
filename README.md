# SG Weather

A mobile-first web app that shows Singapore's **1-hour PM2.5 concentration by region** (central, north, south, east, west), read live from data.gov.sg by the app's own server code. This is the 1-hour PM2.5 concentration in µg/m³. It is **not** the 24-hour PSI.

The screen shows the selected region's reading with NEA's band and health recommendation, and a tappable map of the five regions. The region you pick, by tapping or with "Use my location", is remembered on your phone; only its name is stored, never a reading, and your position never leaves the phone. Data re-fetches every 5 minutes, when you come back to the page, and on Refresh. The design is recorded under "UI" in `Context.md`.

A **PSI** tab shows the latest 24-hour Pollutant Standards Index (PSI, an index with no unit) on the same screen design: the selected region's PSI with NEA's descriptor, health recommendation and band colour, and the region map with a five-band legend. The selected region is shared by both tabs; the app always opens on PM2.5.

A **Telegram bot, HazeUncle,** answers `/psi` and `/pm25` in chat from the same data, and answers questions in your own words in a friendly Singlish "uncle" voice, powered by Claude (see "Telegram bot" below).

Datasets live in a registry, so more data.gov.sg datasets (weather or not) can be added later as one registry entry plus one screen.

The brief is in `MasterPrompt.md` (the original web-app-only brief is archived in `docs/archive/`). Every later instruction and decision is in `Context.md`, and errors are in `error_log.txt`.

## Data source and licence

- Dataset: [PM2.5](https://data.gov.sg/datasets?query=pm2.5&resultId=d_e1058d6974c877257e32048ab128ad83) (`d_e1058d6974c877257e32048ab128ad83`), National Environment Agency (NEA).
- Endpoint: `GET https://api-open.data.gov.sg/v2/real-time/api/pm25`, optionally with `date=YYYY-MM-DD` or `date=YYYY-MM-DDTHH:mm:ss` (Singapore time).
- Band thresholds: NEA's 1-hour PM2.5 concentration bands, from [haze.gov.sg](https://www.haze.gov.sg) (`shared/datasets/pm25-bands.ts`).
- Dataset: [Pollutant Standards Index (PSI)](https://data.gov.sg/datasets?query=psi&resultId=d_fe37906a0182569d891506e815e819b7) (`d_fe37906a0182569d891506e815e819b7`), NEA. Endpoint `GET https://api-open.data.gov.sg/v2/real-time/api/psi`, with the same `date` option. Only `psi_twenty_four_hourly` is shown.
- PSI bands: the owner's table following NEA (`shared/datasets/psi-bands.ts`): Good 0–50, Moderate 51–100, Unhealthy 101–200, Very Unhealthy 201–300, Hazardous 301 and above.
- Licence: Contains information from PM2.5 (or Pollutant Standards Index (PSI)) accessed on the date shown in the app from data.gov.sg which is made available under the terms of the [Singapore Open Data Licence version 1.0](https://data.gov.sg/open-data-licence).

## Run it locally

Requires Node 24.x (`engines` in package.json).

```sh
npm install
npm run dev        # app + /api/data + /api/health on one port, no Vercel CLI or login
npm run check      # typecheck, tests, build: run before every commit
```

### Optional API key

The app works without a key. A data.gov.sg API key only raises the rate limit (without one, data.gov.sg may answer HTTP 429). To use one locally, copy `.env.example` to `.env` and fill in `DATAGOV_API_KEY`. The key is read only on the server (`api/_lib/env.ts`). It is sent to data.gov.sg as the `x-api-key` header and is never sent to the browser, put in a URL, or logged. Never commit `.env`.

## Endpoints

### `GET /api/data?dataset=<id>&<parameters>`

`dataset=pm25` and `dataset=psi` each take one optional parameter, `date` (`YYYY-MM-DD` for a whole Singapore day, or `YYYY-MM-DDTHH:mm:ss` for the latest reading at that moment). Without `date` you get the latest reading.

Success (`200`, `Cache-Control: public, s-maxage=300, stale-while-revalidate=300`; an earlier day uses 86400):

```json
{
  "ok": true,
  "dataset": "pm25",
  "params": {},
  "source": {
    "name": "data.gov.sg",
    "agency": "National Environment Agency (NEA)",
    "datasetId": "d_e1058d6974c877257e32048ab128ad83",
    "datasetPage": "https://data.gov.sg/datasets?query=pm2.5&resultId=d_e1058d6974c877257e32048ab128ad83",
    "endpoint": "https://api-open.data.gov.sg/v2/real-time/api/pm25"
  },
  "fetchedAt": "2026-10-15T13:20:00.000Z",
  "data": {
    "unit": "µg/m³",
    "regions": [
      { "id": "central", "name": "Central", "latitude": 1.35735, "longitude": 103.82 },
      { "id": "north", "name": "North", "latitude": 1.41803, "longitude": 103.82 }
    ],
    "readings": [
      {
        "timestamp": "2026-10-15T21:00:00+08:00",
        "updatedTimestamp": "2026-10-15T21:15:35+08:00",
        "values": { "central": 217, "north": 125, "south": 144, "east": 182, "west": 156 }
      }
    ]
  }
}
```

(The example's regions list is shortened. A real reply lists all five.)

Failure (`Cache-Control: no-store`):

```json
{
  "ok": false,
  "dataset": "pm25",
  "error": {
    "status": 429,
    "upstreamStatus": 429,
    "upstreamCode": 24,
    "upstreamName": "TOO_MANY_REQUESTS",
    "message": "data.gov.sg rate limit reached. Try again in a minute."
  }
}
```

| Situation | Status |
| --- | --- |
| Method other than GET | 405 (`Allow: GET`) |
| Missing or unknown dataset | 404 |
| Unknown or invalid parameter | 400 |
| data.gov.sg 400 | 400 with its `errorMsg` |
| data.gov.sg 404, or no readings | 404 |
| data.gov.sg 429 | 429 (passes on `Retry-After`) |
| data.gov.sg 5xx, `code` ≠ 0, bad JSON or schema, more than 5 pages, unreachable | 502 |
| data.gov.sg slower than 10 s | 504 |
| Anything else | 500 |

Nothing is retried automatically.

### `GET /api/health`

Checks each dataset's latest endpoint once (5-second timeout each): PM2.5 first, then PSI. Answers `200` when every checked dataset returned valid data, otherwise `503`, and each block says whether that dataset is fine. `?dataset=pm25` or `?dataset=psi` checks just one; an unknown name answers `404`. Always `Cache-Control: no-store`. (One function for all datasets keeps the web app at two serverless functions.)

```json
{
  "ok": true,
  "checkedAt": "2026-10-17T12:40:00.000Z",
  "keyConfigured": true,
  "healthPM25": {
    "ok": true,
    "endpoint": "https://api-open.data.gov.sg/v2/real-time/api/pm25",
    "status": 200,
    "code": 0,
    "latencyMs": 184,
    "latestTimestamp": "2026-10-17T20:00:00+08:00",
    "message": "data.gov.sg answered with valid PM2.5 data."
  },
  "healthPSI": {
    "ok": true,
    "endpoint": "https://api-open.data.gov.sg/v2/real-time/api/psi",
    "status": 200,
    "code": 0,
    "latencyMs": 201,
    "latestTimestamp": "2026-10-17T20:00:00+08:00",
    "message": "data.gov.sg answered with valid PSI data."
  },
  "datasets": ["pm25", "psi"]
}
```

### `POST /api/telegram`

The Telegram webhook; only Telegram calls it. See "Telegram bot" below.

| Situation | Status |
| --- | --- |
| Method other than POST | 405 (`Allow: POST`) |
| `TELEGRAM_WEBHOOK_SECRET` not set | 503 |
| Missing or wrong `X-Telegram-Bot-Api-Secret-Token` header | 401 |
| Anything else, including failures | 200 `{ "ok": true }`, so Telegram never retries |

## Telegram bot

Commands (any capitalisation):

| Command | Reply |
| --- | --- |
| `/start`, `/help` | What the bot does and the commands |
| `/psi` or `/psi <region>` | Latest 24-hour PSI for all five regions, or one |
| `/pm25` or `/pm25 <region>` | Latest 1-hour PM2.5 (µg/m³) for all five regions, or one |
| `/forget` | Clears what HazeUncle remembers of this chat |
| Anything else | Haze Uncle answers in his own words (see "Haze Uncle" below) |

Each reading shows the value, the band and the health recommendation (from the same band files as the web app), the reading time in Singapore time, and ends with "Data from NEA via data.gov.sg. Not medical advice." A missing value shows "No reading", an unknown region lists the valid ones, and other text gets the help. If the data can't be fetched, the bot says "I couldn't fetch that right now, please try again." and nothing more.

How it is built:

```
Telegram ──> api/telegram.ts            thin adapter: checks the secret, reads the text, sends the reply
               └─> shared/bot/handle-command.ts   the "brain": channel-neutral, no fetch, no settings
                     └─> api/_bot/get-data.ts      calls the app's own GET /api/data
                           └─> /api/data           the same URL and 5-minute cache the web app uses
```

The bot never imports the data.gov.sg fetching code in `api/_lib/` (a test enforces this). Another chat app (for example WhatsApp) would need only a new thin adapter next to `api/telegram.ts`.

Settings, in Vercel only (placeholders in `.env.example`; never commit real values):

| Variable | Where | What |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Production, Preview | From BotFather; used only to send replies |
| `TELEGRAM_WEBHOOK_SECRET` | Production, Preview | Any long random string; the same one is given to Telegram when registering the webhook |
| `APP_BASE_URL` | Production | `https://sg-data-api.vercel.app` |
| `ANTHROPIC_API_KEY` | Production, Preview | Haze Uncle's Claude key (Anthropic Console); set a monthly spend limit there |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Production, Preview | Set by Vercel when an Upstash Redis store is added under Storage (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` also work) |

Preview deployments find their own address through `VERCEL_URL`, and get past Deployment Protection with `VERCEL_AUTOMATION_BYPASS_SECRET`; Vercel provides both once "Protection Bypass for Automation" is turned on in the project's Deployment Protection settings.

Telegram sends a bot's messages to one webhook address at a time. Register (or move) it from your own terminal, never pasting the token into a chat:

```sh
curl -s "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<host>/api/telegram" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  -d 'allowed_updates=["message"]'
curl -s "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"   # check it
```

The bot can't be reached from `npm run dev` (Telegram needs a public HTTPS address); locally it is covered by the tests.

### Haze Uncle (Claude)

Any message that isn't a command goes to Haze Uncle: Claude (`claude-haiku-5-5`, set in `api/_bot/claude.ts`) with a friendly, no-nonsense Singaporean uncle persona (`shared/bot/persona.ts`).

- **Topic:** air quality and haze in Singapore only. Anything else gets a short redirect to `/help`.
- **Numbers:** every reading comes from the `get_psi` / `get_pm25` tools, which call the app's own `/api/data` during that answer; Claude never guesses or reuses an old number. Replies that quote readings end with "Data from NEA via data.gov.sg. Not medical advice."
- **Limits:** 30 Haze Uncle answers per person per Singapore day; the owner's monthly spend limit in the Anthropic Console caps the total. `/psi` and `/pm25` are always free.
- **Strikes:** per person, over a rolling 12 hours, the 2nd off-topic or abusive message gets a warning and the 3rd a ban notice; that person then gets no replies at all for 24 hours.
- **What is stored** (Upstash Redis; everything expires on its own): the text of the last 10 exchanges per chat, cleared after 24 hours of silence or at once with `/forget`; strike times (12 hours), mutes (24 hours), daily counts (2 days) and recently seen Telegram update ids (1 hour). No readings and nothing else.
- **If Claude or the store is not set up,** plain messages get the help text, as before Haze Uncle.

## How to add a dataset

The web app has exactly two serverless functions, however many datasets exist (the Telegram bot adds a third, `api/telegram.ts`). For a dataset in data.gov.sg's **real-time API family** (`https://api-open.data.gov.sg/v2/real-time/api/...`), touch only these files:

1. `shared/datasets/<id>.ts`: the definition, built with `defineDataset`. It holds `id`, `title`, `category`, `agency`, `datasetId`, `datasetPage`, `source: { kind: "realtime", path: "/<path>" }`, `params` (one validator per allowed query parameter), the zod `schema` of one success page, `mergePages`, `normalize`, `isEmpty`, `notFoundMessage` and `cacheSeconds`. It contains types and pure functions only: no `process.env`, no `fetch`, no secrets.
2. One line in `shared/datasets/registry.ts`.
3. `src/views/<Name>View.tsx`, plus one line in `src/views/index.ts`. The typecheck fails if a dataset has no screen.
4. A fixture in `tests/fixtures/` (a real reply) and its tests.
5. An entry in `Context.md`.

Nothing in `api/` changes.

A dataset **outside** the real-time family (most non-weather data.gov.sg datasets, keyed by their `d_` ID) needs a new `source` kind. First read that dataset's API page on data.gov.sg. Then add the kind to `DatasetSource` in `shared/datasets/types.ts` and a fetch function in `api/_lib/`, and record it in `Context.md`. The switch in `api/_lib/fetch-dataset.ts` is exhaustive, so the typecheck fails until the new kind is handled.

## Deploying on Vercel

GitHub holds the repository and Vercel deploys from it:

1. In Vercel, import the GitHub repository.
2. Keep the detected **Vite** framework preset (build `npm run build`, output `dist`).
3. Set the Node.js version to **24.x**.
4. Optionally, add `DATAGOV_API_KEY` under Environment Variables for Production and Preview.
5. For the Telegram bot, add its settings and register the webhook (see "Telegram bot" above).

Nothing else needs configuring. `api/` is detected automatically, and successful replies are cached at Vercel's CDN, so repeat visits don't spend data.gov.sg's rate limit. Once deployed, open `/api/health` to check the deployment without opening the app.
