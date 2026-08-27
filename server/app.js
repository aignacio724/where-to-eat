const express = require("express");
const cors = require("cors");

const { validateCoordinates } = require("./coordinates");
const { validateAddress } = require("./address");
const { apiLimiter } = require("./rateLimit");

const MAX_RESULT_COUNT = 20;
const RADIUS = 8046.0; // 5 miles
const PLACES_URL = "https://places.googleapis.com/v1/places:searchNearby";
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const FIELD_MASK =
  "places.displayName,places.formattedAddress,places.rating,places.location";

// Read lazily rather than at module load so tests can control the environment
// and so a key added after boot is picked up.
const getApiKey = () => process.env.GOOGLE_MAPS_API_KEY;

const app = express();

app.use(cors()); // Allows React to communicate with this server
app.use(express.json());

app.post("/api/restaurants", async (req, res) => {
  // Google Places API requires coordinates: latitude, longitude
  const details = validateCoordinates(req.body);

  if (details.length > 0) {
    return res.status(400).json({ error: "Invalid coordinates", details });
  }

  const { latitude, longitude } = req.body;

  // make post request to google places api 'searchNearBy'
  try {
    const response = await fetch(PLACES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": getApiKey(),
        // list of fields to return in the response
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        includedTypes: ["restaurant"],
        maxResultCount: MAX_RESULT_COUNT,
        locationRestriction: {
          circle: {
            center: { latitude, longitude },
            radius: RADIUS,
          },
        },
      }),
    });

    if (response.status >= 400) {
      // Deliberately does not forward Google's response body, which can echo
      // back request details we would rather not expose to the browser.
      return res
        .status(response.status)
        .json({ error: response.statusText || "Places API request failed" });
    }

    const data = await response.json();
    return res.json(data);
  } catch (error) {
    console.error("Places API request failed:", error);
    return res.status(500).json({ error: "Failed to fetch restaurants" });
  }
});

app.post("/api/geocode", async (req, res) => {
  const details = validateAddress(req.body);

  if (details.length > 0) {
    return res.status(400).json({ error: "Invalid address", details });
  }

  const { address } = req.body;

  // Unlike the Places API, the Geocoding web service takes the key as a query
  // param. URLSearchParams encodes the address for us.
  const query = new URLSearchParams({ address, key: getApiKey() ?? "" });

  try {
    const response = await fetch(`${GEOCODE_URL}?${query}`);

    if (response.status >= 400) {
      // Same reasoning as /api/restaurants: do not forward Google's body.
      return res
        .status(response.status)
        .json({ error: response.statusText || "Geocoding request failed" });
    }

    const data = await response.json();

    // The Geocoding web service reports failures as a `status` field on an
    // HTTP 200, so checking the status code alone is not enough.
    if (data.status === "ZERO_RESULTS") {
      return res.status(404).json({ error: "No results found for that address" });
    }

    if (data.status !== "OK") {
      // data.error_message can echo request details, so it is not forwarded.
      console.error("Geocoding API returned status:", data.status);
      return res.status(502).json({ error: "Could not look up that address" });
    }

    const [result] = data.results ?? [];
    const location = result?.geometry?.location;

    if (!location) {
      console.error("Geocoding API returned OK with no usable result");
      return res.status(502).json({ error: "Could not look up that address" });
    }

    return res.json({
      latitude: location.lat,
      longitude: location.lng,
      formattedAddress: result.formatted_address,
    });
  } catch (error) {
    console.error("Geocoding API request failed:", error);
    return res.status(500).json({ error: "Failed to look up address" });
  }
});

// express.json() throws on a malformed body. Without this, Express's default
// handler answers with an HTML stack trace instead of the JSON the client expects.
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Malformed JSON body" });
  }
  // express.json()'s size limit rejects with this; without it the client would
  // get Express's HTML error page instead of JSON.
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body is too large" });
  }
  return next(err);
});

module.exports = {
  app,
  MAX_RESULT_COUNT,
  RADIUS,
  PLACES_URL,
  GEOCODE_URL,
  FIELD_MASK,
};
