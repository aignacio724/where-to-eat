const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

const { app, TEST_API_KEY, fakeResponse, mockFetch, resetRateLimit } = require("./helpers");
const { createApiLimiter, MAX_REQUESTS } = require("../rateLimit");

const SF = { latitude: 37.7749, longitude: -122.4194 };

/** A throwaway app wrapping its own limiter, so the shared one is untouched. */
function appWithLimit(max) {
  const { limiter } = createApiLimiter({ windowMs: 60_000, max });
  const testApp = express();

  testApp.use("/api", limiter);
  testApp.get("/api/ping", (req, res) => res.json({ ok: true }));

  return testApp;
}

test.describe("api rate limiting", () => {
  test.describe("the limiter middleware", () => {
    test("allows requests up to the limit", async () => {
      const testApp = appWithLimit(3);

      for (let i = 0; i < 3; i += 1) {
        await request(testApp).get("/api/ping").expect(200);
      }
    });

    test("returns 429 once the limit is exceeded", async () => {
      const testApp = appWithLimit(2);

      await request(testApp).get("/api/ping").expect(200);
      await request(testApp).get("/api/ping").expect(200);

      const res = await request(testApp).get("/api/ping").expect(429);

      assert.match(res.body.error, /too many requests/i);
    });

    test("answers 429 in the same { error } shape the routes use", async () => {
      const testApp = appWithLimit(1);

      await request(testApp).get("/api/ping");
      const res = await request(testApp).get("/api/ping").expect(429);

      assert.equal(typeof res.body.error, "string");
      assert.equal(res.body.details, undefined);
    });

    test("sets the standard RateLimit headers", async () => {
      const testApp = appWithLimit(5);

      const res = await request(testApp).get("/api/ping").expect(200);

      assert.ok(res.headers["ratelimit"], "expected a RateLimit header");
      assert.equal(res.headers["x-ratelimit-limit"], undefined, "legacy headers should be off");
    });

    test("counters are independent per limiter instance", async () => {
      const first = appWithLimit(1);
      const second = appWithLimit(1);

      await request(first).get("/api/ping").expect(200);
      await request(first).get("/api/ping").expect(429);

      // A separate limiter must not inherit the exhausted counter.
      await request(second).get("/api/ping").expect(200);
    });
  });

  test.describe("wired into the real app", () => {
    let originalKey;

    test.beforeEach(() => {
      resetRateLimit();
      originalKey = process.env.GOOGLE_MAPS_API_KEY;
      process.env.GOOGLE_MAPS_API_KEY = TEST_API_KEY;
    });

    test.afterEach(() => {
      resetRateLimit();
      if (originalKey === undefined) {
        delete process.env.GOOGLE_MAPS_API_KEY;
      } else {
        process.env.GOOGLE_MAPS_API_KEY = originalKey;
      }
    });

    test("eventually rejects a flood of restaurant searches", async (t) => {
      const fetchMock = mockFetch(t, async () => fakeResponse({ body: { places: [] } }));

      let sawTooMany = false;

      // One past the budget is enough to trip it.
      for (let i = 0; i < MAX_REQUESTS + 1; i += 1) {
        const res = await request(app).post("/api/restaurants").send(SF);
        if (res.status === 429) {
          sawTooMany = true;
          break;
        }
      }

      assert.ok(sawTooMany, `expected a 429 within ${MAX_REQUESTS + 1} requests`);
      assert.ok(
        fetchMock.mock.calls.length <= MAX_REQUESTS,
        "a rate-limited request must not reach Google"
      );
    });

    test("the limit is shared across both api routes", async (t) => {
      mockFetch(t, async () => fakeResponse({ body: { places: [] } }));

      for (let i = 0; i < MAX_REQUESTS; i += 1) {
        await request(app).post("/api/restaurants").send(SF);
      }

      // Budget spent on /api/restaurants, so /api/geocode is refused too.
      await request(app).post("/api/geocode").send({ address: "anywhere" }).expect(429);
    });

    test("resetRateLimit clears the counters", async (t) => {
      mockFetch(t, async () => fakeResponse({ body: { places: [] } }));

      for (let i = 0; i < MAX_REQUESTS + 1; i += 1) {
        await request(app).post("/api/restaurants").send(SF);
      }

      resetRateLimit();

      await request(app).post("/api/restaurants").send(SF).expect(200);
    });
  });

  test.describe("request body size limit", () => {
    test.beforeEach(() => {
      resetRateLimit();
    });

    test("rejects an oversized body with 413 json, not html", async () => {
      const res = await request(app)
        .post("/api/geocode")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ address: "a".repeat(20_000) }))
        .expect(413)
        .expect("Content-Type", /json/);

      assert.equal(res.body.error, "Request body is too large");
    });

    test("still accepts a normal body", async () => {
      const res = await request(app).post("/api/geocode").send({ address: "" });

      // 400 from validation, not 413 -- the body itself was accepted.
      assert.equal(res.status, 400);
    });
  });
});