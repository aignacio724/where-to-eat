import type { Mock, TestContext } from "node:test";

import { app } from "../app.ts";
import { resetRateLimit } from "../rateLimit.ts";

const TEST_API_KEY = "test-api-key-do-not-use";

interface FakeResponseOptions {
  status?: number;
  statusText?: string;
  body?: unknown;
}

// A minimal stand-in for the subset of the Fetch Response interface that
// app.ts actually touches.
interface FakeResponse {
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}

/** What a test swaps in for fetch: same arguments, resolving to a fake response. */
type FetchImpl = (...args: Parameters<typeof fetch>) => Promise<FakeResponse>;

type FetchMock = Mock<typeof fetch | FetchImpl>;

function fakeResponse({
  status = 200,
  statusText = "OK",
  body = {},
}: FakeResponseOptions = {}): FakeResponse {
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
function mockFetch(t: TestContext, impl: FetchImpl): FetchMock {
  return t.mock.method(globalThis, "fetch", impl);
}

/** Reads the JSON body that app.ts handed to fetch, as an object. */
function requestBodyOf(fetchMock: FetchMock, callIndex = 0) {
  const [, init] = fetchMock.mock.calls[callIndex].arguments;
  // app.ts always sends a JSON string body.
  return JSON.parse(init?.body as string);
}

/** Reads the headers app.ts handed to fetch, which it passes as a plain object. */
function requestHeadersOf(fetchMock: FetchMock, callIndex = 0): Record<string, string> {
  const [, init] = fetchMock.mock.calls[callIndex].arguments;
  return init?.headers as Record<string, string>;
}

export {
  app,
  TEST_API_KEY,
  fakeResponse,
  mockFetch,
  requestBodyOf,
  requestHeadersOf,
  resetRateLimit,
};
