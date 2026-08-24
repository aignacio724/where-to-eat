require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const apiKey = process.env.GOOGLE_MAPS_API_KEY
const MAX_RESULT_COUNT = 20
const RADIUS = 8046.0 // 5 miles

app.use(cors()); // Allows React to communicate with this server
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    hasApiKey: Boolean(apiKey),
  });
});

app.post("/api/restaurants", async (req, res) => {
  // Google Places API requires coordinates
  // latitude, longitude
  const {latitude, longitude} = req.body

  // make post request to google places api 'searchNearBy'
  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        // list of fields to return in the response
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.rating,places.location"
      },
      body: JSON.stringify({
        includedTypes: ["restaurant"],
        maxResultCount: MAX_RESULT_COUNT,
        locationRestriction: {
          circle: {
            center: { latitude, longitude },
            radius: RADIUS
          }
        }
      })
    });

    if (response.status >= 400) {
      res.json(response.status).json({ error: response.statusText})
    } else {
      const data = await response.json();
      res.json(data);
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch restaurants" });
  }
})

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
