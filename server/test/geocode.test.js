const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const {
  app,
  TEST_API_KEY,
  fakeResponse,
  mockFetch,
  resetRateLimit,
} = require("./helpers");
const { GEOCODE_URL } = require("../app");

const ADDRESS = "1600 Amphitheatre Pkwy, Mountain View, CA";

const GEOCODE_PAYLOAD = {
  status: "OK",
  results: [
    {
      formatted_address: "1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
      geometry: { location: { lat: 37.4224, lng: -122.0842 } },
    },
  ],
};

/** Reads the URL app.js handed to fetch. */
function requestUrlOf(fetchMock, callIndex = 0) {
  return fetchMock.mock.calls[callIndex].arguments[0];
}

test.describe("POST /api/geocode", () => {
  let originalKey;

  test.beforeEach(() => {
    // Counters are shared across the whole suite, so clear them per test
    // rather than letting one case exhaust the budget for the next.
    resetRateLimit();
    originalKey = process.env.GOOGLE_MAPS_API_KEY;
    process.env.GOOGLE_MAPS_API_KEY = TEST_API_KEY;
  });

  test.afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
      process.env.GOOGLE_MAPS_API_KEY = originalKey;
    }
  });

  test.describe("happy path", () => {
    test("returns normalized coordinates for an address", async (t) => {
      mockFetch(t, async () => fakeResponse({ body: GEOCODE_PAYLOAD }));

      const res = await request(app)
        .post("/api/geocode")
        .send({ address: ADDRESS })
        .expect(200)
        .expect("Content-Type", /json/);

      assert.deepEqual(res.body, {
        latitude: 37.4224,
        longitude: -122.0842,
        formattedAddress: "1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
      });
    });

    test("does not pass through Google's raw response shape", async (t) => {
      mockFetch(t, async () => fakeResponse({ body: GEOCODE_PAYLOAD }));

      const res = await request(app).post("/api/geocode").send({ address: ADDRESS });

      assert.equal(res.body.results, undefined);
      assert.equal(res.body.status, undefined);
    });

    test("url-encodes the address and key into the query string", async (t) => {
      const fetchMock = mockFetch(t, async () => fakeResponse({ body: GEOCODE_PAYLOAD }));

      await request(app).post("/api/geocode").send({ address: ADDRESS }).expect(200);

      const url = new URL(requestUrlOf(fetchMock));

      assert.ok(url.href.startsWith(GEOCODE_URL));
      // Round-tripping through URL proves the raw string was encoded, commas
      // and spaces included.
      assert.equal(url.searchParams.get("address"), ADDRESS);
      assert.equal(url.searchParams.get("key"), TEST_API_KEY);
      assert.ok(!url.search.includes(" "), "space was not encoded");
    });

    test("uses the first result when Google returns several", async (t) => {
      mockFetch(t, async () =>
        fakeResponse({
          body: {
            status: "OK",
            results: [
              GEOCODE_PAYLOAD.results[0],
              {
                formatted_address: "Somewhere else",
                geometry: { location: { lat: 1, lng: 2 } },
              },
            ],
          },
        })
      );

      const res = await request(app).post("/api/geocode").send({ address: ADDRESS });

      assert.equal(res.body.latitude, 37.4224);
    });

    test("accepts coordinates at 0, 0 without treating them as missing", async (t) => {
      mockFetch(t, async () =>
        fakeResponse({
          body: {
            status: "OK",
            results: [
              {
                formatted_address: "Null Island",
                geometry: { location: { lat: 0, lng: 0 } },
              },
            ],
          },
        })
      );

      const res = await request(app)
        .post("/api/geocode")
        .send({ address: "Null Island" })
        .expect(200);

      assert.equal(res.body.latitude, 0);
      assert.equal(res.body.longitude, 0);
    });
  });

  test.describe("request validation", () => {
    test("returns 400 with details when the address is missing", async (t) => {
      const fetchMock = mockFetch(t, async () => fakeResponse({ body: GEOCODE_PAYLOAD }));

      const res = await request(app).post("/api/geocode").send({}).expect(400);

      assert.equal(res.body.error, "Invalid address");
      assert.ok(res.body.details.length > 0);
      assert.equal(fetchMock.mock.calls.length, 0, "should not call Google");
    });

    test("returns 400 for a blank address", async (t) => {
      const fetchMock = mockFetch(t, async () => fakeResponse({ body: GEOCODE_PAYLOAD }));

      await request(app).post("/api/geocode").send({ address: "   " }).expect(400);

      assert.equal(fetchMock.mock.calls.length, 0, "should not call Google");
    });

    test("returns 400 for a malformed JSON body", async () => {
      const res = await request(app)
        .post("/api/geocode")
        .set("Content-Type", "application/json")
        .send("{not json")
        .expect(400);

      assert.equal(res.body.error, "Malformed JSON body");
    });
  });

  test.describe("google status handling", () => {
    test("maps ZERO_RESULTS to a 404", async (t) => {
      mockFetch(t, async () => fakeResponse({ body: { status: "ZERO_RESULTS", results: [] } }));

      const res = await request(app)
        .post("/api/geocode")
        .send({ address: "asdfghjkl qwerty" })
        .expect(404);

      assert.equal(res.body.error, "No results found for that address");
    });

    test("maps other non-OK statuses to a 502", async (t) => {
      for (const status of ["OVER_QUERY_LIMIT", "REQUEST_DENIED", "INVALID_REQUEST", "UNKNOWN_ERROR"]) {
        mockFetch(t, async () => fakeResponse({ body: { status } }));

        const res = await request(app)
          .post("/api/geocode")
          .send({ address: ADDRESS })
          .expect(502);

        assert.equal(res.body.error, "Could not look up that address");
      }
    });

    test("does not leak Google's error_message on a non-OK status", async (t) => {
      mockFetch(t, async () =>
        fakeResponse({
          body: {
            status: "REQUEST_DENIED",
            error_message: `The provided API key is invalid: ${TEST_API_KEY}`,
          },
        })
      );

      const res = await request(app).post("/api/geocode").send({ address: ADDRESS }).expect(502);

      assert.ok(
        !JSON.stringify(res.body).includes(TEST_API_KEY),
        "API key leaked to the client"
      );
    });

    test("returns 502 when OK carries no results", async (t) => {
      mockFetch(t, async () => fakeResponse({ body: { status: "OK", results: [] } }));

      await request(app).post("/api/geocode").send({ address: ADDRESS }).expect(502);
    });

    test("returns 502 when the result has no geometry", async (t) => {
      mockFetch(t, async () =>
        fakeResponse({
          body: { status: "OK", results: [{ formatted_address: "Nowhere" }] },
        })
      );

      await request(app).post("/api/geocode").send({ address: ADDRESS }).expect(502);
    });
  });

  test.describe("upstream errors", () => {
    test("forwards a 403 from the Geocoding API", async (t) => {
      mockFetch(t, async () => fakeResponse({ status: 403, statusText: "Forbidden" }));

      const res = await request(app).post("/api/geocode").send({ address: ADDRESS }).expect(403);

      assert.equal(res.body.error, "Forbidden");
    });

    test("falls back to a generic message when statusText is empty", async (t) => {
      mockFetch(t, async () => fakeResponse({ status: 500, statusText: "" }));

      const res = await request(app).post("/api/geocode").send({ address: ADDRESS }).expect(500);

      assert.equal(res.body.error, "Geocoding request failed");
    });

    test("does not leak the API key in an upstream error response", async (t) => {
      mockFetch(t, async () =>
        fakeResponse({
          status: 403,
          statusText: "Forbidden",
          body: { error_message: `API key not valid: ${TEST_API_KEY}` },
        })
      );

      const res = await request(app).post("/api/geocode").send({ address: ADDRESS }).expect(403);

      assert.ok(
        !JSON.stringify(res.body).includes(TEST_API_KEY),
        "API key leaked to the client"
      );
    });
  });

  test.describe("catch branch", () => {
    test("returns 500 when fetch rejects (network failure)", async (t) => {
      mockFetch(t, async () => {
        throw new Error("ECONNREFUSED");
      });

      const res = await request(app).post("/api/geocode").send({ address: ADDRESS }).expect(500);

      assert.equal(res.body.error, "Failed to look up address");
    });

    test("returns 500 when the response body is not valid JSON", async (t) => {
      mockFetch(t, async () => ({
        status: 200,
        statusText: "OK",
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      }));

      await request(app).post("/api/geocode").send({ address: ADDRESS }).expect(500);
    });

    test("does not leak the underlying error message to the client", async (t) => {
      mockFetch(t, async () => {
        throw new Error(`connect ECONNREFUSED using ${TEST_API_KEY}`);
      });

      const res = await request(app).post("/api/geocode").send({ address: ADDRESS }).expect(500);

      assert.ok(
        !JSON.stringify(res.body).includes(TEST_API_KEY),
        "API key leaked to the client"
      );
    });
  });

  test.describe("routing", () => {
    test("GET /api/geocode is a 404, not a hang", async () => {
      await request(app).get("/api/geocode").expect(404);
    });

    test("responds to CORS preflight", async () => {
      await request(app)
        .options("/api/geocode")
        .set("Origin", "http://localhost:5173")
        .set("Access-Control-Request-Method", "POST")
        .expect(204);
    });
  });
});