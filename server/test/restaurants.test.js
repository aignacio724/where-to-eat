const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const {
  app,
  TEST_API_KEY,
  fakeResponse,
  mockFetch,
  requestBodyOf,
  requestHeadersOf,
} = require("./helpers");
const { MAX_RESULT_COUNT, RADIUS, PLACES_URL, FIELD_MASK } = require("../app");

const SF = { latitude: 37.7749, longitude: -122.4194 };

const PLACES_PAYLOAD = {
  places: [
    {
      displayName: { text: "Tartine Bakery" },
      formattedAddress: "600 Guerrero St, San Francisco, CA 94110",
      rating: 4.5,
      location: { latitude: 37.7614, longitude: -122.4241 },
    },
    {
      displayName: { text: "Zuni Cafe" },
      formattedAddress: "1658 Market St, San Francisco, CA 94102",
      rating: 4.4,
      location: { latitude: 37.7735, longitude: -122.4222 },
    },
  ],
};

test.describe("POST /api/restaurants", () => {
  let originalKey;

  test.beforeEach(() => {
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
    test("returns the list of places for a coordinate", async (t) => {
      mockFetch(t, async () => fakeResponse({ body: PLACES_PAYLOAD }));

      const res = await request(app)
        .post("/api/restaurants")
        .send(SF)
        .expect(200)
        .expect("Content-Type", /json/);

      assert.deepEqual(res.body, PLACES_PAYLOAD);
      assert.equal(res.body.places.length, 2);
    });

    test("sends the correct URL, method and headers to Google", async (t) => {
      const fetchMock = mockFetch(t, async () => fakeResponse({ body: PLACES_PAYLOAD }));

      await request(app).post("/api/restaurants").send(SF).expect(200);

      assert.equal(fetchMock.mock.callCount(), 1);

      const [url, init] = fetchMock.mock.calls[0].arguments;
      assert.equal(url, PLACES_URL);
      assert.equal(init.method, "POST");

      const headers = requestHeadersOf(fetchMock);
      assert.equal(headers["Content-Type"], "application/json");
      assert.equal(headers["X-Goog-Api-Key"], TEST_API_KEY);
      assert.equal(headers["X-Goog-FieldMask"], FIELD_MASK);
    });

    test("sends the correct search payload to Google", async (t) => {
      const fetchMock = mockFetch(t, async () => fakeResponse({ body: PLACES_PAYLOAD }));

      await request(app).post("/api/restaurants").send(SF).expect(200);

      assert.deepEqual(requestBodyOf(fetchMock), {
        includedTypes: ["restaurant"],
        maxResultCount: MAX_RESULT_COUNT,
        locationRestriction: {
          circle: {
            center: { latitude: SF.latitude, longitude: SF.longitude },
            radius: RADIUS,
          },
        },
      });
    });

    test("accepts 0, 0 rather than treating it as missing input", async (t) => {
      const fetchMock = mockFetch(t, async () => fakeResponse({ body: { places: [] } }));

      await request(app)
        .post("/api/restaurants")
        .send({ latitude: 0, longitude: 0 })
        .expect(200);

      assert.deepEqual(requestBodyOf(fetchMock).locationRestriction.circle.center, {
        latitude: 0,
        longitude: 0,
      });
    });

    test("passes through an empty result set as a 200, not an error", async (t) => {
      mockFetch(t, async () => fakeResponse({ body: { places: [] } }));

      const res = await request(app).post("/api/restaurants").send(SF).expect(200);

      assert.deepEqual(res.body, { places: [] });
    });

    test("passes through an empty object when Google finds nothing", async (t) => {
      // Places omits the `places` key entirely when there are no matches.
      mockFetch(t, async () => fakeResponse({ body: {} }));

      const res = await request(app).post("/api/restaurants").send(SF).expect(200);

      assert.deepEqual(res.body, {});
    });
  });

  test.describe("bad input", () => {
    test("rejects a body with no coordinates", async (t) => {
      const fetchMock = mockFetch(t, async () => fakeResponse());

      const res = await request(app).post("/api/restaurants").send({}).expect(400);

      assert.equal(res.body.error, "Invalid coordinates");
      assert.equal(res.body.details.length, 2);
      // Never spend a Google API call on input we already know is invalid.
      assert.equal(fetchMock.mock.callCount(), 0);
    });

    test("rejects a request with no body at all", async (t) => {
      const fetchMock = mockFetch(t, async () => fakeResponse());

      await request(app).post("/api/restaurants").expect(400);

      assert.equal(fetchMock.mock.callCount(), 0);
    });

    test("rejects a missing longitude", async (t) => {
      mockFetch(t, async () => fakeResponse());

      const res = await request(app)
        .post("/api/restaurants")
        .send({ latitude: SF.latitude })
        .expect(400);

      assert.equal(res.body.details.length, 1);
      assert.ok(res.body.details[0].includes("longitude"));
    });

    test("rejects coordinates sent as strings", async (t) => {
      mockFetch(t, async () => fakeResponse());

      const res = await request(app)
        .post("/api/restaurants")
        .send({ latitude: "37.7749", longitude: "-122.4194" })
        .expect(400);

      assert.equal(res.body.details.length, 2);
    });

    test("rejects out-of-range coordinates", async (t) => {
      const fetchMock = mockFetch(t, async () => fakeResponse());

      await request(app)
        .post("/api/restaurants")
        .send({ latitude: 91, longitude: -122.4194 })
        .expect(400);

      await request(app)
        .post("/api/restaurants")
        .send({ latitude: 37.7749, longitude: 181 })
        .expect(400);

      assert.equal(fetchMock.mock.callCount(), 0);
    });

    test("rejects null coordinates", async (t) => {
      mockFetch(t, async () => fakeResponse());

      await request(app)
        .post("/api/restaurants")
        .send({ latitude: null, longitude: null })
        .expect(400);
    });

    test("rejects malformed JSON without crashing", async (t) => {
      const fetchMock = mockFetch(t, async () => fakeResponse());

      // express.json() surfaces a parse failure as a 400 before the handler runs.
      const res = await request(app)
        .post("/api/restaurants")
        .set("Content-Type", "application/json")
        .send('{"latitude": 37.77, "longitude":')
        .expect(400)
        .expect("Content-Type", /json/);

      assert.deepEqual(res.body, { error: "Malformed JSON body" });
      assert.equal(fetchMock.mock.callCount(), 0);
    });
  });

  test.describe("upstream errors", () => {
    const upstreamStatuses = [400, 401, 403, 429, 500, 503];

    for (const status of upstreamStatuses) {
      test(`forwards a ${status} from the Places API`, async (t) => {
        mockFetch(t, async () =>
          fakeResponse({ status, statusText: `Upstream ${status}` })
        );

        const res = await request(app)
          .post("/api/restaurants")
          .send(SF)
          .expect(status)
          .expect("Content-Type", /json/);

        assert.equal(res.body.error, `Upstream ${status}`);
      });
    }

    test("falls back to a generic message when statusText is empty", async (t) => {
      // HTTP/2 responses have no reason phrase, so statusText is "".
      mockFetch(t, async () => fakeResponse({ status: 403, statusText: "" }));

      const res = await request(app).post("/api/restaurants").send(SF).expect(403);

      assert.equal(res.body.error, "Places API request failed");
    });

    test("does not leak the API key in an upstream error response", async (t) => {
      mockFetch(t, async () =>
        fakeResponse({
          status: 403,
          statusText: "Forbidden",
          // Google's real 403 body echoes the key back.
          body: { error: { message: `API key not valid: ${TEST_API_KEY}` } },
        })
      );

      const res = await request(app).post("/api/restaurants").send(SF).expect(403);

      assert.ok(
        !JSON.stringify(res.body).includes(TEST_API_KEY),
        "API key leaked to the client"
      );
    });

    test("returns 399 as a success passthrough (boundary of the >= 400 check)", async (t) => {
      mockFetch(t, async () => fakeResponse({ status: 399, body: PLACES_PAYLOAD }));

      const res = await request(app).post("/api/restaurants").send(SF).expect(200);

      assert.deepEqual(res.body, PLACES_PAYLOAD);
    });
  });

  test.describe("catch branch", () => {
    test("returns 500 when fetch rejects (network failure)", async (t) => {
      t.mock.method(console, "error", () => {});
      mockFetch(t, async () => {
        throw new TypeError("fetch failed");
      });

      const res = await request(app).post("/api/restaurants").send(SF).expect(500);

      assert.deepEqual(res.body, { error: "Failed to fetch restaurants" });
    });

    test("returns 500 when the response body is not valid JSON", async (t) => {
      t.mock.method(console, "error", () => {});
      mockFetch(t, async () => ({
        status: 200,
        statusText: "OK",
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      }));

      const res = await request(app).post("/api/restaurants").send(SF).expect(500);

      assert.deepEqual(res.body, { error: "Failed to fetch restaurants" });
    });

    test("does not leak the underlying error message to the client", async (t) => {
      t.mock.method(console, "error", () => {});
      mockFetch(t, async () => {
        throw new Error(`connect ECONNREFUSED using ${TEST_API_KEY}`);
      });

      const res = await request(app).post("/api/restaurants").send(SF).expect(500);

      assert.ok(!JSON.stringify(res.body).includes(TEST_API_KEY));
      assert.ok(!JSON.stringify(res.body).includes("ECONNREFUSED"));
    });
  });

  test.describe("routing", () => {
    test("GET /api/restaurants is a 404, not a hang", async () => {
      await request(app).get("/api/restaurants").expect(404);
    });

    test("unknown routes are a 404", async () => {
      await request(app).get("/api/nope").expect(404);
    });

    test("responds to CORS preflight", async () => {
      const res = await request(app)
        .options("/api/restaurants")
        .set("Origin", "http://localhost:5173")
        .set("Access-Control-Request-Method", "POST")
        .expect(204);

      assert.equal(res.headers["access-control-allow-origin"], "*");
    });
  });
});
