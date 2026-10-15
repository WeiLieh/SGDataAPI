import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../api/health.js";
import { call, fixtureText, upstream } from "./helpers.js";

const TEST_KEY = "health-test-key-5b1e";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("DATAGOV_API_KEY", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("answers 200 with the latest timestamp when data.gov.sg returns valid data", async () => {
    fetchMock.mockResolvedValueOnce(upstream(fixtureText("pm25-latest.json")));
    const res = await call(handler, "/api/health");
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    const body = res.json();
    expect(body).toMatchObject({
      ok: true,
      keyConfigured: false,
      upstream: {
        endpoint: "https://api-open.data.gov.sg/v2/real-time/api/pm25",
        status: 200,
        code: 0,
        latestTimestamp: "2026-10-15T21:00:00+08:00",
      },
      datasets: ["pm25"],
    });
    expect(typeof body.upstream.latencyMs).toBe("number");
    expect(typeof body.upstream.message).toBe("string");
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
  });

  it("answers 503 on a 429", async () => {
    fetchMock.mockResolvedValueOnce(upstream(fixtureText("pm25-error-429.json"), 429));
    const res = await call(handler, "/api/health");
    expect(res.statusCode).toBe(503);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json()).toMatchObject({
      ok: false,
      upstream: {
        status: 429,
        code: 24,
        latestTimestamp: null,
        message: "data.gov.sg rate limit reached. Try again in a minute.",
      },
    });
  });

  it("answers 503 with a 5-second timeout message", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"));
    const res = await call(handler, "/api/health");
    expect(res.statusCode).toBe(503);
    expect(res.json().upstream).toMatchObject({ status: null, message: "data.gov.sg did not answer within 5 seconds." });
  });

  it("reports keyConfigured true without ever exposing the key", async () => {
    vi.stubEnv("DATAGOV_API_KEY", TEST_KEY);
    fetchMock.mockResolvedValueOnce(upstream(fixtureText("pm25-latest.json")));
    const res = await call(handler, "/api/health");
    expect(res.json().keyConfigured).toBe(true);
    expect(res.body).not.toContain(TEST_KEY);
    expect(JSON.stringify(res.headers)).not.toContain(TEST_KEY);
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(TEST_KEY);
  });

  it("answers 405 to POST", async () => {
    const res = await call(handler, "/api/health", "POST");
    expect(res.statusCode).toBe(405);
    expect(res.headers.allow).toBe("GET");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
