const { app } = require("../app");

const TEST_API_KEY = "test-api-key-do-not-use";

// A minimal stand-in for the subset of the Fetch Response interface that
// app.js actually touches.
function fakeResponse({ status = 200, statusText = "OK", body = {} } = {}) {
  return {
    status,
    statusText,
    json: async () => body,
  };
}

/**
 * Replaces global fetch for the duration of a single test. `t.mock` is
 * restored automatically when the test ends, so there is no teardown to
 * forget. Returns the mock so tests can assert on the call arguments.
 */
function mockFetch(t, impl) {
  return t.mock.method(globalThis, "fetch", impl);
}

/** Reads the JSON body that app.js handed to fetch, as an object. */
function requestBodyOf(fetchMock, callIndex = 0) {
  const [, init] = fetchMock.mock.calls[callIndex].arguments;
  return JSON.parse(init.body);
}

/** Reads the headers app.js handed to fetch. */
function requestHeadersOf(fetchMock, callIndex = 0) {
  const [, init] = fetchMock.mock.calls[callIndex].arguments;
  return init.headers;
}

module.exports = {
  app,
  TEST_API_KEY,
  fakeResponse,
  mockFetch,
  requestBodyOf,
  requestHeadersOf,
};
