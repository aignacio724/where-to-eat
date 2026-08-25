const express = require("express");
const cors = require("cors");

const { validateCoordinates } = require("./coordinates");

const MAX_RESULT_COUNT = 20;
const RADIUS = 8046.0; // 5 miles
const PLACES_URL = "https://places.googleapis.com/v1/places:searchNearby";
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

// express.json() throws on a malformed body. Without this, Express's default
// handler answers with an HTML stack trace instead of the JSON the client expects.
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Malformed JSON body" });
  }
  return next(err);
});

module.exports = { app, MAX_RESULT_COUNT, RADIUS, PLACES_URL, FIELD_MASK };
