import type { Mock, TestContext } from "node:test";

export { app } from "../app.ts";
export { resetRateLimit } from "../rateLimit.ts";

export const TEST_API_KEY = "test-api-key-do-not-use";

export type FetchMock = Mock<typeof fetch>;

// A minimal stand-in for the subset of the Fetch Response interface that
// app.ts actually touches.
export function fakeResponse({
  status = 200,
  statusText = "OK",
  body = {} as unknown,
} = {}) {
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
 *
 * `impl` may resolve to a partial Response such as fakeResponse() builds,
 * hence the cast to fetch's full signature.
 */
export function mockFetch(
  t: TestContext,
  impl: (...args: Parameters<typeof fetch>) => Promise<unknown>
): FetchMock {
  return t.mock.method(globalThis, "fetch", impl as typeof fetch);
}

/** Reads the JSON body that app.ts handed to fetch, as an object. */
export function requestBodyOf(fetchMock: FetchMock, callIndex = 0) {
  const [, init] = fetchMock.mock.calls[callIndex].arguments;
  return JSON.parse(init?.body as string);
}

/** Reads the headers app.ts handed to fetch. */
export function requestHeadersOf(fetchMock: FetchMock, callIndex = 0) {
  const [, init] = fetchMock.mock.calls[callIndex].arguments;
  return init?.headers as Record<string, string>;
}
