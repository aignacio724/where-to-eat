import { useEffect, useRef, useState } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin, useMapsLibrary } from '@vis.gl/react-google-maps';

const DEFAULT_CENTER = { lat: 37.7749, lng: -122.4194 };
const DEFAULT_ZOOM = 13;
const SUGGESTION_DEBOUNCE_MS = 300;
// Autocomplete bills per request and this app uses no session token, so every
// keystroke pause costs. One- and two-character prefixes return nothing useful
// anyway, so they are not worth sending.
const MIN_SUGGESTION_LENGTH = 3;

/**
 * Reads the JSON error a route returned, falling back to `fallback` when the
 * body is missing or unreadable. Both /api routes answer with { error, details? }.
 */
async function errorMessageFrom(response, fallback) {
  const body = await response.json().catch(() => ({}));
  const details = body.details?.length ? `: ${body.details.join(", ")}` : "";
  return (body.error || fallback) + details;
}

// useMapsLibrary reads APIProvider's context, so it cannot live in the
// component that renders APIProvider — hence this inner component.
function RestaurantFinder() {
  const [restaurants, setRestaurants] = useState([]);
  const [userLocation, setUserLocation] = useState(DEFAULT_CENTER);
  const [error, setError] = useState(null);
  const [address, setAddress] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  // Controlled camera: the Map needs onCameraChanged alongside center/zoom,
  // otherwise it pins the view and panning snaps back.
  const [cameraProps, setCameraProps] = useState({
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
  });

  const places = useMapsLibrary('places');
  // Picking a suggestion sets `address`, which would otherwise immediately
  // re-open the dropdown with that same text.
  const skipNextSuggestionFetch = useRef(false);

  useEffect(() => {
    if (!places) return;

    if (skipNextSuggestionFetch.current) {
      skipNextSuggestionFetch.current = false;
      return;
    }

    let cancelled = false;

    // Every setState below is deliberately inside this callback rather than the
    // effect body, which would cascade an extra render on each keystroke.
    const timer = setTimeout(async () => {
      if (address.trim().length < MIN_SUGGESTION_LENGTH) {
        if (!cancelled) setSuggestions([]);
        return;
      }

      try {
        const { suggestions: results } =
          await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({ input: address });

        // A slower earlier request must not overwrite a newer one.
        if (cancelled) return;

        setSuggestions(
          results
            .map((suggestion) => suggestion.placePrediction?.text?.text)
            .filter(Boolean)
        );
      } catch {
        // Suggestions are a convenience; a failure here must not block the
        // typed address from being searched.
        if (!cancelled) setSuggestions([]);
      }
    }, SUGGESTION_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [places, address]);

  /** Shared tail of both entry points: recenter, then search from a coordinate. */
  const searchRestaurantsAt = async (latitude, longitude) => {
    setUserLocation({ lat: latitude, lng: longitude });
    setCameraProps((props) => ({ ...props, center: { lat: latitude, lng: longitude } }));

    // Relative URL so Vite's dev proxy forwards this to the Express
    // server (see vite.config.js). Same-origin, so no CORS involved.
    try {
      const response = await fetch("/api/restaurants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude, longitude })
      });

      if (!response.ok) {
        setError(await errorMessageFrom(response, "Could not fetch restaurants"));
        return;
      }

      const data = await response.json();
      setRestaurants(data.places || []);
    } catch {
      setError("Could not reach the server. Is it running?");
    }
  };

  const findRestaurants = () => {
    setError(null);

    if (!navigator.geolocation) {
      setError("This browser does not support location services. Enter an address instead.");
      return;
    }

    setIsSearching(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        await searchRestaurantsAt(latitude, longitude);
        setIsSearching(false);
      },
      (positionError) => {
        setError(`Could not get your location (${positionError.message}). Enter an address instead.`);
        setIsSearching(false);
      }
    );
  };

  const searchByAddress = async (event) => {
    event.preventDefault();
    setError(null);

    if (address.trim() === "") {
      setError("Enter an address to search.");
      return;
    }

    setSuggestions([]);
    setIsSearching(true);

    try {
      const response = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address })
      });

      if (!response.ok) {
        setError(await errorMessageFrom(response, "Could not look up that address"));
        return;
      }

      const { latitude, longitude } = await response.json();
      await searchRestaurantsAt(latitude, longitude);
    } catch {
      setError("Could not reach the server. Is it running?");
    } finally {
      setIsSearching(false);
    }
  };

  const pickSuggestion = (text) => {
    skipNextSuggestionFetch.current = true;
    setAddress(text);
    setSuggestions([]);
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <button
        onClick={findRestaurants}
        disabled={isSearching}
        style={{ padding: '10px' }}
      >
        Find Food Near Me
      </button>

      <form onSubmit={searchByAddress} style={{ marginTop: '12px' }}>
        <label htmlFor="address" style={{ display: 'block', fontSize: '14px', marginBottom: '4px' }}>
          ...or enter an address:
        </label>

        {/* Positioned wrapper so the dropdown anchors to the input rather than
            the full-width form. */}
        <span style={{ position: 'relative', display: 'inline-block' }}>
          <input
            id="address"
            type="text"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="1600 Amphitheatre Pkwy"
            autoComplete="off"
            style={{ padding: '10px', width: '320px', maxWidth: '100%', boxSizing: 'border-box' }}
          />

          {suggestions.length > 0 && (
            <ul className="suggestions">
              {suggestions.map((text) => (
                <li key={text}>
                  <button type="button" onClick={() => pickSuggestion(text)}>
                    {text}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </span>

        <button type="submit" disabled={isSearching} style={{ padding: '10px', marginLeft: '8px' }}>
          Search
        </button>
      </form>

      {error && (
        <p className="error" style={{ marginTop: '12px' }}>{error}</p>
      )}

      <div style={{ height: '600px', width: '100%', borderRadius: '8px', overflow: 'hidden', marginTop: '20px' }}>
        <Map
          {...cameraProps}
          onCameraChanged={(event) => setCameraProps(event.detail)}
          mapId="DEMO_MAP_ID"
        >

          {/* User's Location Pin (Blue) */}
          <AdvancedMarker position={userLocation}>
            <Pin background={"#4285F4"} borderColor={"#1967D2"} glyphColor={"#FFF"} />
          </AdvancedMarker>

          {/* Restaurant Pins (Red) */}
          {restaurants.map((place, index) => (
            <AdvancedMarker
              key={index}
              position={{ lat: place.location.latitude, lng: place.location.longitude }}
              title={place.displayName.text}
            />
          ))}
        </Map>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY} libraries={['places']}>
      <RestaurantFinder />
    </APIProvider>
  );
}