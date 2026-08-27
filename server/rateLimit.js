const { rateLimit, MemoryStore, MINUTE } = require("express-rate-limit");

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || MINUTE;
const MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX) || 30;

/**
 * Builds a limiter for the /api routes. Both of them spend real money at
 * Google, so this is the chokepoint that bounds a runaway client -- whether
 * that is a scraped key, a stuck retry loop, or a debounce regression.
 *
 * The store is created here rather than left implicit so tests can reset it
 * between cases instead of having to disable rate limiting outright.
 */
function createApiLimiter({ windowMs = WINDOW_MS, max = MAX_REQUESTS } = {}) {
  const store = new MemoryStore();

  const limiter = rateLimit({
    windowMs,
    limit: max,
    store,
    // draft-8 emits the standard RateLimit-* headers; the X-RateLimit-*
    // legacy pair adds nothing for a browser client.
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // Answer in the same { error } shape the routes use, so the client's
    // existing error handling renders it without a special case.
    handler: (req, res) =>
      res.status(429).json({ error: "Too many requests. Please wait a moment and try again." }),
  });

  return { limiter, store };
}

const { limiter: apiLimiter, store: apiLimiterStore } = createApiLimiter();

/** Clears all counters. Used by tests so one case cannot exhaust the next. */
function resetRateLimit() {
  apiLimiterStore.resetAll();
}

module.exports = {
  createApiLimiter,
  apiLimiter,
  resetRateLimit,
  WINDOW_MS,
  MAX_REQUESTS,
};