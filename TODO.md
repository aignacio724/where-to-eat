# TODO

## Landing page and pick flow

- [ ] **Don't load the Google map on first page load.** Defer the Maps JS script
      until there is something to show — loading it up front bills a Dynamic Maps
      load for every visitor, including ones who never search.
- [ ] Add a description on the landing page:

      > Can't decide where to eat? Endlessly scrolling a list or cycling through
      > points on a map? Let me pick for you. Indecisive? I'll keep picking until
      > there's only one place to eat

- [ ] Show only the "Find a place to eat" button and the address input on the
      landing page. Everything else appears after a search.
- [ ] Add a "Picking for you" animation while the search runs, then reveal the
      map with the results.
- [ ] **Implement the random pick.** This project was described as making "a
      random selection to suggest a place to eat", but the app currently plots
      every result and picks nothing.
- [ ] Add a "reroll / pick again" mechanism.
  - [ ] Reroll picks a new place from the *initial* result list, removing the
        previously picked place each time — the list shrinks until one is left.
        No new Places call per reroll.

## Deployment blockers

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

## Robustness

- [ ] The rate limiter uses an in-memory store — it resets on restart and is
      per-process. Multiple instances need a shared store (e.g. Redis).
- [ ] Add a `GET /health` endpoint. Playwright's `webServer.url` currently has
      nothing meaningful to poll.
- [ ] Cache geocode results. The same address resolving repeatedly is pure
      wasted spend.

## Testing

- [ ] Playwright E2E specs (`client/e2e/`, already excluded from Vitest):
      geolocation denied/granted, address search, autocomplete. Use
      `page.route` to stub Google so specs are deterministic and free, and
      raise `RATE_LIMIT_MAX` for the run so the suite does not rate-limit
      itself.
- [ ] Visual regression via `toHaveScreenshot()` in both color schemes. A
      dark-mode contrast bug once made the suggestions dropdown render white on
      white — the text was present the whole time, so no DOM assertion would
      have caught it.

## Cost

- [ ] Consider `AutocompleteSessionToken` + Place Details if autocomplete cost
      becomes material, accepting the token-forwarding complexity.
