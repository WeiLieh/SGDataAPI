import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import handler from "../api/data.js";
import { call, fixtureJson, fixtureText, pm25Page, upstream } from "./helpers.js";

const ENDPOINT = "https://api-open.data.gov.sg/v2/real-time/api/pm25";
const TEST_KEY = "test-key-do-not-leak-7f3a9c";

let fetchMock: ReturnType<typeof vi.fn>;
let errorLog: MockInstance;
let otherLogs: MockInstance[];

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("DATAGOV_API_KEY", "");
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  otherLogs = (["log", "warn", "info", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function requestedUrl(n = 0): URL {
  return new URL(String(fetchMock.mock.calls[n]?.[0]));
}

function requestedHeaders(n = 0): Record<string, string> {
  return (fetchMock.mock.calls[n]?.[1] as RequestInit).headers as Record<string, string>;
}

function expectFailureShape(res: { headers: Record<string, string>; json: () => any }, status: number) {
  const body = res.json();
  expect(body.ok).toBe(false);
  expect(body.error.status).toBe(status);
  expect(res.headers["cache-control"]).toBe("no-store");
  expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
  expect(res.headers["x-content-type-options"]).toBe("nosniff");
  expect(body.error.message.length).toBeLessThanOrEqual(200);
  return body;
}

describe("GET /api/data success", () => {
  it("fetches the latest PM2.5 reading from the registry URL and normalizes it", async () => {
    fetchMock.mockResolvedValueOnce(upstream(fixtureText("pm25-latest.json")));
    const res = await call(handler, "/api/data?dataset=pm25");

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedUrl().toString()).toBe(ENDPOINT);
    expect(requestedHeaders()).toEqual({ Accept: "application/json" });
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);

    const body = res.json();
    expect(body).toMatchObject({
      ok: true,
      dataset: "pm25",
      params: {},
      source: {
        name: "data.gov.sg",
        agency: "National Environment Agency (NEA)",
        datasetId: "d_e1058d6974c877257e32048ab128ad83",
        datasetPage: "https://data.gov.sg/datasets?query=pm2.5&resultId=d_e1058d6974c877257e32048ab128ad83",
        endpoint: ENDPOINT,
      },
    });
    expect(Number.isNaN(Date.parse(body.fetchedAt))).toBe(false);
    expect(body.data.readings[0].values).toEqual({ central: 217, north: 125, south: 144, east: 182, west: 156 });
    expect(res.headers["cache-control"]).toBe("public, s-maxage=300, stale-while-revalidate=300");
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("caches an earlier day for 86400 seconds and passes the date upstream", async () => {
    fetchMock.mockResolvedValueOnce(upstream(fixtureText("pm25-latest.json")));
    const res = await call(handler, "/api/data?dataset=pm25&date=2026-10-01");
    expect(res.statusCode).toBe(200);
    expect(requestedUrl().searchParams.get("date")).toBe("2026-10-01");
    expect(res.json().params).toEqual({ date: "2026-10-01" });
    expect(res.headers["cache-control"]).toBe("public, s-maxage=86400, stale-while-revalidate=86400");
  });

  it("follows paginationToken across two pages and drops duplicate timestamps", async () => {
    fetchMock
      .mockResolvedValueOnce(
        upstream(
          pm25Page(
            [
              { timestamp: "2026-10-01T01:00:00+08:00", values: { north: 11 } },
              { timestamp: "2026-10-01T02:00:00+08:00", values: { north: 12 } },
            ],
            "page-2-token",
          ),
        ),
      )
      .mockResolvedValueOnce(
        upstream(
          pm25Page([
            { timestamp: "2026-10-01T02:00:00+08:00", values: { north: 12 } },
            { timestamp: "2026-10-01T00:00:00+08:00", values: { north: 10 } },
          ]),
        ),
      );

    const res = await call(handler, "/api/data?dataset=pm25&date=2026-10-01");
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestedUrl(0).searchParams.has("paginationToken")).toBe(false);
    expect(requestedUrl(1).searchParams.get("paginationToken")).toBe("page-2-token");
    expect(requestedUrl(1).searchParams.get("date")).toBe("2026-10-01");
    const body = res.json();
    expect(body.data.readings.map((r: any) => r.values.north)).toEqual([10, 11, 12]);
    expect(body.source.endpoint).toBe(`${ENDPOINT}?date=2026-10-01`);
    expect(JSON.stringify(body)).not.toContain("page-2-token");
  });
});

describe("GET /api/data error map", () => {
  it("upstream 400 → 400 with data.gov.sg's errorMsg", async () => {
    fetchMock.mockResolvedValueOnce(upstream(fixtureText("pm25-error-400.json"), 400));
    const res = await call(handler, "/api/data?dataset=pm25&date=2026-10-01");
    expect(res.statusCode).toBe(400);
    const body = expectFailureShape(res, 400);
    expect(body).toEqual({
      ok: false,
      dataset: "pm25",
      error: {
        status: 400,
        upstreamStatus: 400,
        upstreamCode: 4,
        upstreamName: "ERROR_PARAMS",
        message: fixtureJson<{ errorMsg: string }>("pm25-error-400.json").errorMsg,
      },
    });
  });

  it("upstream 404 → 404 naming the date", async () => {
    fetchMock.mockResolvedValueOnce(upstream(fixtureText("pm25-error-404.json"), 404));
    const res = await call(handler, "/api/data?dataset=pm25&date=2026-10-01");
    expect(res.statusCode).toBe(404);
    const body = expectFailureShape(res, 404);
    expect(body.error).toMatchObject({
      upstreamStatus: 404,
      upstreamCode: 17,
      upstreamName: "REAL_TIME_API_DATA_NOT_FOUND",
      message: "data.gov.sg has no PM2.5 readings for 2026-10-01.",
    });
  });

  it("upstream 404 without a date → 'right now'", async () => {
    fetchMock.mockResolvedValueOnce(upstream(fixtureText("pm25-error-404.json"), 404));
    const res = await call(handler, "/api/data?dataset=pm25");
    expect(expectFailureShape(res, 404).error.message).toBe("data.gov.sg has no PM2.5 readings right now.");
  });

  it("upstream 429 → 429 with Retry-After passed through, and no retry", async () => {
    fetchMock.mockResolvedValueOnce(upstream(fixtureText("pm25-error-429.json"), 429, { "Retry-After": "42" }));
    const res = await call(handler, "/api/data?dataset=pm25");
    expect(res.statusCode).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.headers["retry-after"]).toBe("42");
    const body = expectFailureShape(res, 429);
    expect(body.error).toMatchObject({
      upstreamStatus: 429,
      upstreamCode: 24,
      upstreamName: "TOO_MANY_REQUESTS",
      message: "data.gov.sg rate limit reached. Try again in a minute.",
    });
    expect(errorLog).toHaveBeenCalledWith("[api/data] pm25 upstream 429 code 24 TOO_MANY_REQUESTS");
  });

  it("upstream 429 without Retry-After sends no Retry-After", async () => {
    fetchMock.mockResolvedValueOnce(upstream(fixtureText("pm25-error-429.json"), 429));
    const res = await call(handler, "/api/data?dataset=pm25");
    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBeUndefined();
  });

  it.each([500, 503])("upstream %i → 502", async (status) => {
    fetchMock.mockResolvedValueOnce(upstream("<html>down</html>", status));
    const res = await call(handler, "/api/data?dataset=pm25");
    expect(res.statusCode).toBe(502);
    const body = expectFailureShape(res, 502);
    expect(body.error).toMatchObject({ upstreamStatus: status, message: `data.gov.sg returned HTTP ${status}.` });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("HTTP 200 with code other than 0 → 502 with errorMsg", async () => {
    fetchMock.mockResolvedValueOnce(upstream({ code: 9, name: "SOMETHING_ELSE", data: null, errorMsg: "Something broke upstream" }));
    const res = await call(handler, "/api/data?dataset=pm25");
    expect(res.statusCode).toBe(502);
    expect(expectFailureShape(res, 502).error).toMatchObject({
      upstreamStatus: 200,
      upstreamCode: 9,
      upstreamName: "SOMETHING_ELSE",
      message: "Something broke upstream",
    });
  });

  it("body not JSON → 502 unexpected format", async () => {
    fetchMock.mockResolvedValueOnce(upstream("<html>not json</html>"));
    const res = await call(handler, "/api/data?dataset=pm25");
    expect(res.statusCode).toBe(502);
    expect(expectFailureShape(res, 502).error.message).toBe("data.gov.sg returned PM2.5 data in an unexpected format.");
  });

  it("body not matching the schema → 502 unexpected format, zod issues logged on one line", async () => {
    fetchMock.mockResolvedValueOnce(upstream({ code: 0, data: { items: "nope" }, errorMsg: "" }));
    const res = await call(handler, "/api/data?dataset=pm25");
    expect(res.statusCode).toBe(502);
    expect(expectFailureShape(res, 502).error.message).toBe("data.gov.sg returned PM2.5 data in an unexpected format.");
    const line = String(errorLog.mock.calls[0]?.[0]);
    expect(line).toMatch(/^\[api\/data\] pm25 upstream 200 unexpected format: /);
    expect(line).toContain("data.regionMetadata");
    expect(line).not.toContain("\n");
  });

  it("timeout → 504", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    const res = await call(handler, "/api/data?dataset=pm25");
    expect(res.statusCode).toBe(504);
    expect(expectFailureShape(res, 504).error).toMatchObject({
      upstreamStatus: null,
      upstreamCode: null,
      upstreamName: null,
      message: "data.gov.sg did not answer within 10 seconds.",
    });
  });

  it("network failure → 502", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const res = await call(handler, "/api/data?dataset=pm25");
    expect(res.statusCode).toBe(502);
    expect(expectFailureShape(res, 502).error.message).toBe("Could not reach data.gov.sg.");
  });

  it("success with no readings → 404", async () => {
    fetchMock.mockResolvedValueOnce(upstream(pm25Page([])));
    const res = await call(handler, "/api/data?dataset=pm25&date=2026-10-01");
    expect(res.statusCode).toBe(404);
    expect(expectFailureShape(res, 404).error.message).toBe("data.gov.sg has no PM2.5 readings for 2026-10-01.");
  });

  it("anything else → 500 with the stack logged", async () => {
    fetchMock.mockResolvedValueOnce({
      text: async () => fixtureText("pm25-latest.json"),
      get ok(): boolean {
        throw new Error("boom");
      },
    });
    const res = await call(handler, "/api/data?dataset=pm25");
    expect(res.statusCode).toBe(500);
    expect(expectFailureShape(res, 500).error.message).toBe("Unexpected server error.");
    const line = String(errorLog.mock.calls[0]?.[0]);
    expect(line).toContain("Error: boom");
    expect(line).toContain("at ");
  });

  it("more than 5 pages → 502 rather than a partial day", async () => {
    fetchMock.mockImplementation(async () =>
      upstream(pm25Page([{ timestamp: "2026-10-01T01:00:00+08:00", values: { north: 1 } }], "again")),
    );
    const res = await call(handler, "/api/data?dataset=pm25&date=2026-10-01");
    expect(res.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(expectFailureShape(res, 502).error.message).toBe("data.gov.sg returned more pages than expected.");
  });

  it("exactly 5 pages is fine", async () => {
    let page = 0;
    fetchMock.mockImplementation(async () => {
      page += 1;
      const hour = String(page).padStart(2, "0");
      return upstream(
        pm25Page([{ timestamp: `2026-10-01T${hour}:00:00+08:00`, values: { north: page } }], page < 5 ? `t${page}` : undefined),
      );
    });
    const res = await call(handler, "/api/data?dataset=pm25&date=2026-10-01");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.readings).toHaveLength(5);
  });
});

describe("GET /api/data request validation", () => {
  it("unknown dataset → 404 naming the known ids, without calling upstream", async () => {
    const res = await call(handler, "/api/data?dataset=nope");
    expect(res.statusCode).toBe(404);
    const body = expectFailureShape(res, 404);
    expect(body.dataset).toBeNull();
    expect(body.error.message).toContain("pm25");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("missing dataset → 404 naming the known ids", async () => {
    const res = await call(handler, "/api/data");
    expect(res.statusCode).toBe(404);
    expect(expectFailureShape(res, 404).error.message).toContain("pm25");
  });

  it("unknown parameter → 400", async () => {
    const res = await call(handler, "/api/data?dataset=pm25&paginationToken=abc");
    expect(res.statusCode).toBe(400);
    expect(expectFailureShape(res, 400).error.message).toBe('Unknown parameter "paginationToken". Allowed: date.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bad date → 400 with its sentence", async () => {
    const res = await call(handler, "/api/data?dataset=pm25&date=bad");
    expect(res.statusCode).toBe(400);
    expect(expectFailureShape(res, 400).error.message).toBe("Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss (Singapore time).");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("repeated parameter → 400", async () => {
    const res = await call(handler, "/api/data?dataset=pm25&date=2026-10-01&date=2026-10-02");
    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POST → 405 with Allow: GET", async () => {
    const res = await call(handler, "/api/data?dataset=pm25", "POST");
    expect(res.statusCode).toBe(405);
    expect(res.headers.allow).toBe("GET");
    expectFailureShape(res, 405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("DATAGOV_API_KEY", () => {
  function expectNoLeak(res: { body: string; headers: Record<string, string> }) {
    expect(res.body).not.toContain(TEST_KEY);
    expect(JSON.stringify(res.headers)).not.toContain(TEST_KEY);
    for (const spy of [errorLog, ...otherLogs]) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(TEST_KEY);
    }
  }

  it("is sent as x-api-key and appears in no body, header or log", async () => {
    vi.stubEnv("DATAGOV_API_KEY", TEST_KEY);
    fetchMock.mockResolvedValueOnce(upstream(fixtureText("pm25-latest.json")));
    const ok = await call(handler, "/api/data?dataset=pm25");
    expect(ok.statusCode).toBe(200);
    expect(requestedHeaders()["x-api-key"]).toBe(TEST_KEY);
    expect(requestedUrl().toString()).not.toContain(TEST_KEY);
    expectNoLeak(ok);

    fetchMock.mockResolvedValueOnce(upstream(fixtureText("pm25-error-429.json"), 429));
    const limited = await call(handler, "/api/data?dataset=pm25");
    expect(limited.statusCode).toBe(429);
    expectNoLeak(limited);

    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const unreachable = await call(handler, "/api/data?dataset=pm25");
    expectNoLeak(unreachable);
  });

  it("is trimmed, and a blank key sends no header", async () => {
    vi.stubEnv("DATAGOV_API_KEY", "   ");
    fetchMock.mockResolvedValueOnce(upstream(fixtureText("pm25-latest.json")));
    await call(handler, "/api/data?dataset=pm25");
    expect(requestedHeaders()).not.toHaveProperty("x-api-key");
  });

  it("when unset, no x-api-key header is sent", async () => {
    delete process.env.DATAGOV_API_KEY;
    fetchMock.mockResolvedValueOnce(upstream(fixtureText("pm25-latest.json")));
    await call(handler, "/api/data?dataset=pm25");
    expect(requestedHeaders()).not.toHaveProperty("x-api-key");
  });
});
