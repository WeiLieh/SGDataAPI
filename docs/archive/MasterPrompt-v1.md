ARCHIVED: do not follow. This is the original web-app-only brief (v1), kept unchanged below for history. The live brief is MasterPrompt.md at the project root.

MASTER PROMPT · SG Weather · new app that reads data.gov.sg directly, starting with PM2.5
Paste into Claude Code, opened in the empty folder that will become the new GitHub repository.

ROLE: You are a senior full-stack developer starting a new project from an empty folder: a mobile-first Vite + React + TypeScript web app with two Vercel serverless functions in api/, kept in GitHub and deployed by Vercel from GitHub. Claude Code, git and the files in this folder are your only tools; Vercel settings are changed by me.

GOAL: Build a mobile-first weather app called SG Weather that shows Singapore's 1-hour PM2.5 readings by region, fetched by the app's own server code straight from the data.gov.sg real-time API (no MCP server, no third-party wrapper, nothing bundled or invented), built around a dataset registry so that any other data.gov.sg dataset, weather or not, can be added later as one registry entry plus one screen. Keep a written record of every change and every error from the first commit.

OUTPUT:
 1) Project records, before any code.
    a) Save this entire prompt, unchanged, as MasterPrompt.md at the project root. Never edit it afterwards; new or changed instructions go into Context.md.
    b) Create Context.md with the sections "Deployment & Environment", "Data Sources", "Datasets", "UI", "Decisions" and "Git & Release Workflow". Every entry is one bullet starting with the Singapore date as [YYYY-MM-DD]. Add an entry whenever I give new context or a new instruction, and whenever a change alters what the app shows, how it behaves, or how it is built or deployed, in the same commit as that change. When an entry replaces an earlier one, keep the old one, append "(superseded [YYYY-MM-DD], see below)" to it, and say in the new entry what it supersedes. Seed it with the decisions in this prompt.
    c) Create error_log.txt with one line per error: [YYYY-MM-DD] <Kind> Error: <what happened, with the exact message, HTTP status or failing command> (Resolved: <fix> | Open: <next step> | Not a code error: <why>). Kind is one of Build, Type, Test, API, Deploy, Git, Tool, Display, Bug. Log every error, not only bugs in the app: failed tests, type errors, failed commands, git and push failures, permission or tooling failures, and upstream API failures seen during development. When a logged error is fixed later, update that line's status in place instead of adding a new line.
    d) Never write a key, token or secret into MasterPrompt.md, Context.md, error_log.txt, README.md or any other file.
    e) Create CLAUDE.md telling every future session: read MasterPrompt.md and Context.md before changing anything; record changes in Context.md and errors in error_log.txt exactly as defined in 1b and 1c, in the same commit as the change; add datasets only as described in step 5; build the look and feel only from the entries under "UI" in Context.md, never from your own design choices; run npm run check before every commit.
 2) Tooling.
    npm, with package-lock.json as the only lockfile; never add bun.lock, yarn.lock or pnpm-lock.yaml.
    package.json: "type": "module", "engines": { "node": "24.x" }, scripts dev ("vite"), build ("vite build"), preview ("vite preview"), typecheck ("tsc --noEmit"), test ("vitest run") and check ("npm run typecheck && npm run test && npm run build").
    dependencies: react ^19.3.1, react-dom ^19.3.1, zod ^4.6.7. devDependencies: vite ^8.3.4, @vitejs/plugin-react ^6.1.2, typescript ^7.0.2, vitest ^5.0.4, @types/node, @types/react, @types/react-dom. Nothing else without asking me first, and no @vercel/node. Type both handlers with IncomingMessage and ServerResponse from node:http, so the same file runs on Vercel and inside the Vite dev server.
    tsconfig.json: strict, "moduleResolution": "bundler", "jsx": "react-jsx", one config covering src/, api/, shared/ and tests/. Write every relative import in api/ and shared/ with a .js extension (import { registry } from "../shared/datasets/registry.js"), because Vercel runs api/ as Node ES modules and those need the extension; TypeScript resolves the .js to the .ts file.
    .gitignore: node_modules, dist, .vercel, .env and .env.* except !.env.example. .env.example holds only DATAGOV_API_KEY= under a comment saying it is optional.
 3) Folder layout. Vercel turns every file in api/ into a public URL unless its file or folder name starts with an underscore, and the Hobby plan caps a deployment at 12 functions, so there are exactly two functions however many datasets are added:
    api/data.ts: GET /api/data?dataset=<id>&<that dataset's parameters>
    api/health.ts: GET /api/health
    api/_lib/: upstream fetch, pagination, error mapping and JSON response helpers. Server only; the only place that reads process.env.
    shared/datasets/: the registry and one definition file per dataset, imported by both api/ and src/. Types and pure functions only: no process.env, no fetch, no secrets.
    src/: the React app, with src/views/ holding one screen component per dataset.
    tests/ and tests/fixtures/.
 4) PM2.5 facts. Where the published spec and the real response disagree, the real response wins.
    Endpoint: GET https://api-open.data.gov.sg/v2/real-time/api/pm25. Dataset ID d_e1058d6974c877257e32048ab128ad83. Dataset page: https://data.gov.sg/datasets?query=pm2.5&resultId=d_e1058d6974c877257e32048ab128ad83. Agency: National Environment Agency (NEA). Unit: µg/m³. Readings are integers.
    Query: no date returns the latest reading. date=YYYY-MM-DD returns every reading for that Singapore (SGT) day. date=YYYY-MM-DDTHH:mm:ss returns the latest reading at that SGT moment.
    Pagination: data.paginationToken appears only for requests with a date and only when another page exists; request the next page with the same date plus paginationToken=<token>.
    Key: the x-api-key header is optional and only raises the rate limit.
    Success: HTTP 200 with code 0 and errorMsg "". Errors: HTTP 400 with code 4 and name ERROR_PARAMS (bad date format or invalid pagination token); HTTP 404 with code 17 and name REAL_TIME_API_DATA_NOT_FOUND; HTTP 429 with code 24 and name TOO_MANY_REQUESTS. Error bodies carry data: null and a human-readable errorMsg.
    Real response versus spec: the field is data.regionMetadata (camelCase), not region_metadata as the spec's text says; region names are lowercase ("north", "central"), not "West" as in the spec's example; date is a plain "2026-10-15"; timestamp and updatedTimestamp are SGT with an offset ("2026-10-15T21:00:00+08:00"), not the spec's UTC examples or its malformed "+08:0"; readings sit under items[].readings.pm25_one_hourly, keyed by the same lowercase region names. Build the schema and the test fixture from the real response in the Appendix. Still parse defensively: trim and lowercase region names on both sides, accept any ISO 8601 timestamp with an offset, treat a region missing from a reading as null rather than 0, and keep a region that has readings but no metadata (with no coordinates).
    timestamp is the hour the reading covers; updatedTimestamp is when data.gov.sg published it. Show both.
    This is the 1-hour PM2.5 concentration, not the 24-hour PSI. Never label it PSI or derive a PSI from it.
 5) Dataset registry (shared/datasets/registry.ts). This is what leaves room for any other data.gov.sg dataset.
    Each definition has: id (URL-safe, "pm25"), title ("PM2.5"), category (free text, "Air quality"; the app is not limited to weather), agency, datasetId ("d_..."), datasetPage (URL), source, params, schema (zod schema of the upstream success body), normalize(body) returning the dataset's own clean shape, and cacheSeconds(params).
    source is a discriminated union on kind. Implement only { kind: "realtime", path: "/pm25" }, resolved against https://api-open.data.gov.sg/v2/real-time/api. Most non-weather datasets on data.gov.sg are not part of the real-time API family and use a different API, keyed by their d_ dataset ID. Do not build that now: when the first such dataset is added, read that dataset's API page on data.gov.sg, add a new source kind with its own fetch function in api/_lib/, and record it in Context.md. Dispatch on source.kind with an exhaustive switch, so a new kind without a fetch function fails the typecheck.
    params maps each allowed query parameter to a validator returning either the cleaned value or a one-sentence error. Unknown parameters are rejected.
    Export DatasetId as the union of registry keys. src/views/index.ts maps every DatasetId to its screen component with satisfies Record<DatasetId, ...>, so a dataset without a screen fails the typecheck.
    Adding a real-time dataset touches only: shared/datasets/<id>.ts, one line in the registry, src/views/<Name>View.tsx plus one line in src/views/index.ts, a fixture with tests, and a Context.md entry. Nothing in api/ changes.
    api/data.ts fetches only URLs built from registry entries; it never fetches a path or URL taken from the request.
 6) shared/datasets/pm25.ts.
    params: date, optional. Accept exactly YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss, which must be a real calendar date and time ("2026-02-30" and "2026-10-15T24:00:00" fail) and must not be later than the current SGT time ("Date is in the future (Singapore time)."). Any other format fails with "Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss (Singapore time)." paginationToken is not a client parameter; the server follows pages itself (step 7).
    normalize returns { unit: "µg/m³", regions: Array<{ id, name, latitude, longitude }>, readings: Array<{ timestamp, updatedTimestamp, values: Record<regionId, number | null> }> }. name is the id with a capital first letter ("North"). Region order: central, north, south, east, west, then any others alphabetically. Sort readings oldest to newest and drop duplicate timestamps.
    cacheSeconds: 300 with no date or with a date on today's SGT date; 86400 for an earlier day.
    Bands, in shared/datasets/pm25-bands.ts and nowhere else, with the source link https://www.haze.gov.sg: NEA's 1-hour PM2.5 concentration bands: Band I Normal 0–55, Band II Elevated 56–150, Band III High 151–250, Band IV Very High 251 and above, in µg/m³. Note in Context.md that the band values come from NEA and must be checked against haze.gov.sg whenever they are touched.
 7) api/data.ts and api/_lib/.
    Only GET: any other method answers 405 with Allow: GET.
    dataset missing or unknown: 404 naming the known ids. A parameter that fails validation, or an unknown parameter: 400 with its sentence.
    Build the upstream URL from the registry. Send Accept: application/json, and x-api-key only when process.env.DATAGOV_API_KEY is set and not blank. Time out each upstream request after 10 seconds with AbortSignal.timeout.
    With a date, follow paginationToken until none is returned, at most 5 pages; if a sixth would be needed, answer 502 "data.gov.sg returned more pages than expected." rather than a partial day.
    Check response.ok before treating the body as data. Read the body as text and parse JSON inside try. Map failures to these statuses and one-line messages (at most 200 characters):
      upstream 400 → 400 with data.gov.sg's errorMsg;
      upstream 404 → 404 "data.gov.sg has no PM2.5 readings for <date>." (or "...has no PM2.5 readings right now." without a date);
      upstream 429 → 429 "data.gov.sg rate limit reached. Try again in a minute.", passing on the upstream Retry-After header when present;
      upstream 5xx → 502 "data.gov.sg returned HTTP <status>.";
      HTTP 200 with code other than 0 → 502 with errorMsg;
      body not JSON, or not matching the schema → 502 "data.gov.sg returned PM2.5 data in an unexpected format.", with the zod issues logged server-side;
      timeout → 504 "data.gov.sg did not answer within 10 seconds.";
      network failure → 502 "Could not reach data.gov.sg.";
      success with no readings → 404 as above;
      anything else → 500 "Unexpected server error.", with the stack logged server-side.
    Never retry automatically, least of all on a 429: retrying a rate limit only slows the reply and spends more of the limit.
    Success: 200 with { ok: true, dataset, params, source: { name: "data.gov.sg", agency, datasetId, datasetPage, endpoint (the URL without any key) }, fetchedAt (ISO timestamp), data (the normalized shape) } and Cache-Control: public, s-maxage=<cacheSeconds>, stale-while-revalidate=<cacheSeconds>, so Vercel's CDN absorbs repeat visits instead of spending the rate limit.
    Failure: { ok: false, dataset, error: { status, upstreamStatus (number or null), upstreamCode (number or null), upstreamName (string or null), message } } with Cache-Control: no-store.
    Every reply is JSON with Content-Type: application/json; charset=utf-8 and X-Content-Type-Options: nosniff, never an HTML page. Server logs are one line per failure, such as "[api/data] pm25 upstream 429 code 24 TOO_MANY_REQUESTS", and never contain the key, any part of it, or request headers.
 8) api/health.ts. GET only. Calls the PM2.5 latest endpoint once, with a 5-second timeout, and answers { ok, checkedAt, keyConfigured (true or false, never the key), upstream: { endpoint, status, code, latencyMs, latestTimestamp (or null), message }, datasets (the registry ids) }, with status 200 when data.gov.sg answered with valid data and 503 otherwise, and Cache-Control: no-store. Use it to check the deployment without opening the app.
 9) Local development. In vite.config.ts add a small plugin whose configureServer passes every request whose URL starts with /api/data or /api/health to the matching handler, loaded through server.ssrLoadModule("/api/data.ts") so that edits apply without a restart, keeping the full request URL. Load .env with loadEnv(mode, process.cwd(), "") and copy DATAGOV_API_KEY into process.env for the handlers only. npm run dev must serve the app and both endpoints on one port with no Vercel CLI and no login.
 10) Screens. The app is mobile-first. This prompt sets no look and feel: layout, styling, fonts, colours, components, screen features and on-screen wording are designed later through my prompts, each recorded under "UI" in Context.md with the change that builds it. Until the first UI entry exists, build only a plain, unstyled PM2.5 screen that lists each region's latest reading with its timestamp and updatedTimestamp, read from /api/data, so the data path can be checked end to end. Add no styling library and make no design decisions of your own. Whatever the design becomes, these rules about the data hold:
    Show every time in Singapore time, using Intl.DateTimeFormat with timeZone "Asia/Singapore", whatever the browser's time zone.
    A null reading is shown as having no reading, never as 0 and never given a band.
    A failed request shows the API's message and HTTP status, with a way to retry. Nothing on screen is ever bundled, cached in localStorage, hard-coded or invented.
    The reading is never called PSI.
    The data.gov.sg credit required by the licence appears in the app: "Contains information from PM2.5 accessed on <date> from data.gov.sg which is made available under the terms of the Singapore Open Data Licence version 1.0", linking to https://data.gov.sg/open-data-licence.
    An in-flight request is aborted with AbortController when the query changes, so an old reply never overwrites a new one.
 11) Tests (vitest), all offline with fetch mocked:
    tests/fixtures/pm25-latest.json: the Appendix response, verbatim. tests/fixtures/pm25-error-400.json, -404.json and -429.json: the error bodies from step 4.
    normalize on the fixture: five regions with the right coordinates and names, the 21:00 SGT reading with north 125, south 144, west 156, east 182, central 217.
    Defensive parsing: a capitalised region name ("West") still matches; a region missing from a reading becomes null; an unparseable timestamp fails the schema.
    Date validation: "2026-10-15" and "2026-10-15T21:00:00" pass; "2026-02-30", "2026-10-15T24:00:00", "15/10/2026", "2026-10-15T21:00" and tomorrow in SGT fail.
    api/data: each row of the error map in step 7, including timeout and network failure; pagination across two pages, duplicates dropped; more than 5 pages gives 502; unknown dataset 404; unknown parameter 400; POST 405; Cache-Control on success and on failure; Retry-After passed through on a 429.
    The key: with DATAGOV_API_KEY set to a test value, it is sent as x-api-key and appears in no response body, header or console output; with it unset, no x-api-key header is sent.
    Bands at 55, 56, 150, 151, 250 and 251.
    api/health: 200 with the fixture, 503 on a 429, keyConfigured true or false and never the key.
 12) README.md: what the app shows, the data source and licence, npm install and npm run dev, the two endpoints with example replies, the optional DATAGOV_API_KEY, how to add a dataset (step 5), and the Vercel setup steps in the CONTEXT section below.
 13) Git and release.
    If the folder is not a git repository, run git init -b main. If there is no origin remote, stop and ask me for the URL of the empty GitHub repository I created. Never create a repository, change its visibility or push anywhere else on your own.
    Commit in small, working steps with clear messages, each running npm run check first. Push the first complete working version to main, since nothing is live yet.
    After the first Vercel production deploy, make every change on a branch, open a pull request into main, and merge only when npm run check passes, the Vercel preview deploy is green, and I have tested the preview. Merge as soon as a finished task meets those three conditions. Record this workflow in Context.md.
 14) Finish. Run npm run check. Start npm run dev and request /api/health, /api/data?dataset=pm25, /api/data?dataset=pm25&date=<yesterday in SGT>, /api/data?dataset=pm25&date=bad, /api/data?dataset=nope and a POST to /api/data, and confirm each status and body. If data.gov.sg cannot be reached from your environment, log that in error_log.txt as "Not a code error" and say so; don't treat the fixtures as proof the live call works. Then report what was built, what passed, what failed, and anything I must do in GitHub or Vercel.

GUARDRAILS: Read-only: the app only reads public data; nothing writes, sends, deletes or spends. No database, no login, no analytics, no cookies. No fallbacks: a failed call is shown as a failure, never replaced with bundled, sample, cached-in-browser or made-up values, and no screen ever shows a reading data.gov.sg did not return for the current query. The API key is optional; read it only from process.env.DATAGOV_API_KEY on the server; never send it to the browser, never put it in a URL, a response, a log, a comment or any file; never create a variable whose name starts with VITE_. No new npm packages beyond step 2 without asking me first. Never skip, disable or delete a test to get a green check.

CONTEXT: GitHub holds the repository; Vercel deploys from it. Vercel setup, which I do: import the GitHub repository, keep the detected Vite framework preset (build npm run build, output dist), set Node 24.x, and optionally add DATAGOV_API_KEY under Environment Variables for Production and Preview. Nothing else needs configuring; api/ is detected automatically. data.gov.sg rate-limits requests made without a key, answering HTTP 429 with code 24; that is why responses are cached at Vercel's CDN, nothing retries automatically, and the key is supported. The PM2.5 endpoint and dataset are listed in step 4. Future datasets may come from anywhere on data.gov.sg, not only weather.

APPENDIX: a real reply from GET https://api-open.data.gov.sg/v2/real-time/api/pm25 on 2026-10-15. Use it verbatim as tests/fixtures/pm25-latest.json.
{
  "code": 0,
  "data": {
    "regionMetadata": [
      { "name": "north", "labelLocation": { "latitude": 1.41803, "longitude": 103.82 } },
      { "name": "south", "labelLocation": { "latitude": 1.29587, "longitude": 103.82 } },
      { "name": "east", "labelLocation": { "latitude": 1.35735, "longitude": 103.94 } },
      { "name": "west", "labelLocation": { "latitude": 1.35735, "longitude": 103.7 } },
      { "name": "central", "labelLocation": { "latitude": 1.35735, "longitude": 103.82 } }
    ],
    "items": [
      {
        "date": "2026-10-15",
        "updatedTimestamp": "2026-10-15T21:15:35+08:00",
        "timestamp": "2026-10-15T21:00:00+08:00",
        "readings": {
          "pm25_one_hourly": { "north": 125, "south": 144, "west": 156, "east": 182, "central": 217 }
        }
      }
    ]
  },
  "errorMsg": ""
}
