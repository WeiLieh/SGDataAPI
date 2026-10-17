import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../api/health.js";
import { call, fixtureText, upstream } from "./helpers.js";

const TEST_KEY = "health-test-key-5b1e";
const PM25 = "https://api-open.data.gov.sg/v2/real-time/api/pm25";
const PSI = "https://api-open.data.gov.sg/v2/real-time/api/psi";

let fetchMock: ReturnType<typeof vi.fn>;

/** Answers each upstream URL with its own reply, so parallel checks get the right fixture. */
function route(replies: Record<string, () => Response | Promise<Response>>) {
  fetchMock.mockImplementation(async (url: URL | string) => {
    const reply = replies[String(url)];
    if (!reply) throw new Error(`unexpected upstream ${String(url)}`);
    return reply();
  });
}

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
  it("with no dataset checks both, PM2.5 first then PSI, and answers 200 when both are valid", async () => {
    route({
      [PM25]: () => upstream(fixtureText("pm25-latest.json")),
      [PSI]: () => upstream(fixtureText("psi-latest.json")),
    });
    const res = await call(handler, "/api/health");
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    const body = res.json();
    expect(Object.keys(body)).toEqual(["ok", "checkedAt", "keyConfigured", "healthPM25", "healthPSI", "datasets"]);
    expect(body).toMatchObject({
      ok: true,
      keyConfigured: false,
      healthPM25: { ok: true, endpoint: PM25, status: 200, code: 0, latestTimestamp: "2026-10-15T21:00:00+08:00" },
      healthPSI: { ok: true, endpoint: PSI, status: 200, code: 0, latestTimestamp: "2026-10-17T20:00:00+08:00" },
      datasets: ["pm25", "psi"],
    });
    expect(typeof body.healthPM25.latencyMs).toBe("number");
    expect(body.healthPSI.message).toBe("data.gov.sg answered with valid PSI data.");
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
  });

  it("answers 503 and names the failing dataset when one check fails", async () => {
    route({
      [PM25]: () => upstream(fixtureText("pm25-latest.json")),
      [PSI]: () => upstream(fixtureText("pm25-error-429.json"), 429),
    });
    const res = await call(handler, "/api/health");
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      ok: false,
      healthPM25: { ok: true },
      healthPSI: {
        ok: false,
        status: 429,
        code: 24,
        latestTimestamp: null,
        message: "data.gov.sg rate limit reached. Try again in a minute.",
      },
    });
  });

  it.each([
    ["pm25", "healthPM25", PM25, "pm25-latest.json"],
    ["psi", "healthPSI", PSI, "psi-latest.json"],
  ])("?dataset=%s checks only that dataset", async (id, key, endpoint, fixture) => {
    route({ [endpoint]: () => upstream(fixtureText(fixture)) });
    const res = await call(handler, `/api/health?dataset=${id}`);
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = res.json();
    expect(Object.keys(body)).toEqual(["ok", "checkedAt", "keyConfigured", key, "datasets"]);
    expect(body[key]).toMatchObject({ ok: true, endpoint });
  });

  it("answers 503 with a 5-second timeout message", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"));
    const res = await call(handler, "/api/health?dataset=pm25");
    expect(res.statusCode).toBe(503);
    expect(res.json().healthPM25).toMatchObject({ status: null, message: "data.gov.sg did not answer within 5 seconds." });
  });

  it("answers 404 for an unknown dataset, without calling upstream", async () => {
    const res = await call(handler, "/api/health?dataset=nope");
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toContain("pm25, psi");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports keyConfigured true without ever exposing the key", async () => {
    vi.stubEnv("DATAGOV_API_KEY", TEST_KEY);
    route({
      [PM25]: () => upstream(fixtureText("pm25-latest.json")),
      [PSI]: () => upstream(fixtureText("psi-latest.json")),
    });
    const res = await call(handler, "/api/health");
    expect(res.json().keyConfigured).toBe(true);
    expect(res.body).not.toContain(TEST_KEY);
    expect(JSON.stringify(res.headers)).not.toContain(TEST_KEY);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).headers as Record<string, string>).toMatchObject({ "x-api-key": TEST_KEY });
    }
  });

  it("answers 405 to POST", async () => {
    const res = await call(handler, "/api/health", "POST");
    expect(res.statusCode).toBe(405);
    expect(res.headers.allow).toBe("GET");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
