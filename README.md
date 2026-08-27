# where-to-eat

A small project exploring the Google Maps API: find restaurants near a location
and plot them on a map. The location comes either from the browser's geolocation
or from a typed address.

## Running it

```bash
npm install
npm run dev      # server on :3000, client on :5173
```

You need two Google Maps API keys (see [API keys](#api-keys)):

```
server/.env     GOOGLE_MAPS_API_KEY=...
client/.env     VITE_GOOGLE_MAPS_API_KEY=...
```

Other scripts: `npm test` (both workspaces), `npm run lint`, `npm run build`.

## Architecture

```
browser (:5173)                      express (:3000)              google
─────────────────                    ───────────────              ──────
Maps JS ─────────────────────────────────────────────────────────► Maps JavaScript API
Places Autocomplete ─────────────────────────────────────────────► Places API (New)
                                                                   (suggestions only)

fetch("/api/geocode")     ──vite──►  POST /api/geocode     ───────► Geocoding API
fetch("/api/restaurants") ──proxy─►  POST /api/restaurants ───────► Places API (New)
```

**All metered lookups go through Express.** The browser talks only to its own
origin for data; the one exception is autocomplete, which is explained below.

### Why the client uses relative URLs

`client/vite.config.js` proxies `/api` to the Express server, so the frontend
calls `fetch("/api/restaurants")` with no host or port. This keeps requests
same-origin, so CORS never applies in development, and it avoids baking a
`localhost` URL into the bundle.

A hardcoded `http://localhost:3001` here was the original bug in this project.
It surfaced as `CORS request did not succeed` with `Status code: (null)`, which
is misleading — nothing was listening on that port, so the preflight never
reached a server at all. A genuine CORS rejection returns a real status code.

**This proxy is a dev-server feature and does not exist in a production build.**
See the TODO list.

### Server routes

| Route | Calls | Notes |
|---|---|---|
| `POST /api/restaurants` | Places API (New) `searchNearby` | 5 mile radius, max 20 results |
| `POST /api/geocode` | Geocoding API | address → `{ latitude, longitude, formattedAddress }` |

Both answer errors as `{ error, details? }`, so the client renders every failure
through one code path.

Neither route forwards Google's response body on failure. Google's error bodies
can echo the request back, including the API key; tests assert the key never
reaches the client.

**The Geocoding API reports failures as HTTP 200 with a `status` field in the
body.** Checking the status code alone silently accepts `ZERO_RESULTS` as
success. `server/app.js` maps `ZERO_RESULTS` to 404 and other non-`OK` statuses
to 502.

## Design decision: address autocomplete

Four approaches were considered for turning a typed address into coordinates.

| Approach | Trade-off |
|---|---|
| Server-side geocoding only | Testable, key hidden — but a plain text box, no suggestions |
| Client-side `useMapsLibrary('geocoding')` | ~15 lines, no server change — but untested, adds a metered SKU to the public key |
| Client autocomplete + server resolves `placeId` | Most precise — but needs session-token forwarding to bill correctly |
| **Client autocomplete + server resolves the address string** ← chosen | Type-ahead UX, metered call stays server-side, one server branch |

**What we settled on:** Places Autocomplete runs in the browser purely as a UI
affordance. The `placeId` of a picked suggestion is deliberately **ignored** —
selecting one only fills the text box, and search always sends the address
string to `/api/geocode`.

**Why:** it avoids Place Details calls and `AutocompleteSessionToken` plumbing
entirely, keeping the server to a single code path. The cost is slight
imprecision (a text round-trip instead of an exact ID) and per-request rather
than per-session autocomplete billing.

**Consequence:** because there is no session token, every autocomplete request
bills individually. Request volume therefore matters more here than it would in
the `placeId` design — hence the debounce and minimum-length guard.

### Component structure

`useMapsLibrary` reads `APIProvider`'s React context, so it **cannot** be called
from the component that renders `APIProvider` — it would return `null` forever.
`App` is therefore a thin provider wrapper around `RestaurantFinder`, which
holds all state and hooks.

## Security

### API keys

Two separate keys, which is what makes differential restriction possible:

| Key | Visibility | Needs |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | server only, never sent to the browser | Places API (New), Geocoding API |
| `VITE_GOOGLE_MAPS_API_KEY` | **public by construction** | Maps JavaScript API, Places API (New) |

**The browser key cannot be hidden.** The Maps JS API loads via
`<script src="...maps/api/js?key=...">`, so the key travels in a request URL and
is visible in the Network tab. `vite build` also inlines it into the bundle as a
string literal. Google's browser keys are designed to be public; there is no
configuration that changes this.

What that means in practice: enabling an API on the browser key widens what a
scraped key can do. This is why the metered geocoding lookup lives on the server
key instead.

### Restrictions

Restrict each key to only the APIs it needs. A Maps Platform project often has
30+ APIs enabled by default, several of them premium SKUs (Route Optimization,
Solar, Aerial View). An **unrestricted** key that leaks can reach all of them —
the same leak, a wildly different bill.

Note the two dials are separate: *API enablement* is project-level, *API
restrictions* are per-key. Enablement alone costs nothing; enablement combined
with an unrestricted key is the exposure.

Application restrictions differ in strength:

- **IP restriction** (server key) — unforgeable. You cannot spoof a source IP
  and still receive the response.
- **HTTP referrer restriction** (browser key) — a speed bump. `Referer` is just
  a request header; only the browser refuses to forge it. It stops casual reuse
  on someone else's site, not deliberate abuse via `curl`.

### Quotas

**Cloud Billing budgets do not stop spending — they only send alerts.** The
enforcement mechanism is per-API **quota limits** (per-day *and* per-minute) in
the Cloud Console. That is what bounds financial exposure, and it protects
against a runaway loop in your own code just as well as against an attacker.

### Guards in this codebase

| Guard | Where | Purpose |
|---|---|---|
| Rate limit, 30/min per IP | `server/rateLimit.js`, applied to `/api` | Bounds cost; invalid requests count too, so spamming 400s is not free |
| Body cap, 10kb | `express.json({ limit })` | Oversized bodies are rejected with a 413 as JSON, not Express's HTML page |
| Address length cap, 250 | `server/address.js` | Rejected before any Google call |
| Coordinate validation | `server/coordinates.js` | Uses `Number.isFinite`, so `0,0` is valid and `NaN`/strings are not |
| Debounce, 300ms | `client/src/App.jsx` | One autocomplete request per typing pause, not per keystroke |
| Minimum 3 characters | `client/src/App.jsx` | Short prefixes return nothing useful and are not worth billing |

Rate limit defaults are tunable via `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS`.

`express-rate-limit` is used rather than a hand-rolled limiter: a naive limiter
keyed on the raw IP is trivially bypassed over IPv6, where one subscriber
typically controls an entire /64 and can rotate addresses freely.

## Tests

```bash
npm test               # both workspaces
npm run test:server
npm test --workspace=client
```

Two layers, 115 tests:

- **Server** — `node:test` + `supertest`, `server/test/`. `global.fetch` is
  mocked, so no test reaches Google. Covers validation, upstream errors, the
  HTTP-200-with-error-status trap, key-leak assertions, and rate limiting.
  The rate limiter is *tested*, not disabled: `resetRateLimit()` clears the
  store between cases.
- **Client** — Vitest + React Testing Library, `client/src/App.test.jsx`.
  `@vis.gl/react-google-maps` is mocked, so no API key or network is involved.
  Covers both entry paths, every error branch, and the autocomplete guards.

Notes for anyone extending these:

- The user's location pin is also an `AdvancedMarker`. The mock distinguishes
  `restaurant-marker` from `user-marker` by whether `title` is set.
- `userEvent` deadlocks against Vitest's fake timers here. The debounce tests
  use real timers with `delay: null` typing instead.

## TODO before production

**Deployment blockers**

- [ ] **The Vite proxy is dev-only.** A production build has no `/api` proxy.
      Either serve the client build from Express, or introduce a configurable
      API base URL. Relative `fetch("/api/...")` calls will 404 otherwise.
- [ ] **`app.set("trust proxy", ...)`** — behind a reverse proxy every request
      appears to come from the proxy's IP, making the rate limit global rather
      than per-client. See the comment in `server/app.js`.
- [ ] **IP-restrict the server key** once it has a stable address. Deferred
      during local dev because residential IPs rotate.
- [ ] Restrict the browser key: APIs (Maps JS + Places API New) and HTTP
      referrers (`http://localhost:5173/*` plus the production domain).
- [ ] Set per-day and per-minute quota caps on every enabled API.

**Robustness**

- [ ] The rate limiter uses an in-memory store — it resets on restart and is
      per-process. Multiple instances need a shared store (e.g. Redis).
- [ ] Add a `GET /health` endpoint. Playwright's `webServer.url` currently has
      nothing meaningful to poll.
- [ ] Cache geocode results. The same address resolving repeatedly is pure
      wasted spend.

**Features and testing**

- [ ] **The random pick is not implemented.** This project was described as
      making "a random selection to suggest a place to eat", but the app
      currently plots every result and picks nothing.
- [ ] Playwright E2E specs (`client/e2e/`, already excluded from Vitest):
      geolocation denied/granted, address search, autocomplete. Use
      `page.route` to stub Google so specs are deterministic and free, and
      raise `RATE_LIMIT_MAX` for the run so the suite does not rate-limit
      itself.
- [ ] Visual regression via `toHaveScreenshot()` in both color schemes. A
      dark-mode contrast bug once made the suggestions dropdown render white on
      white — the text was present the whole time, so no DOM assertion would
      have caught it.
- [ ] Consider `AutocompleteSessionToken` + Place Details if autocomplete cost
      becomes material, accepting the token-forwarding complexity.