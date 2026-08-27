import { useState } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin } from '@vis.gl/react-google-maps';

const DEFAULT_CENTER = { lat: 37.7749, lng: -122.4194 };
const DEFAULT_ZOOM = 13;

export default function App() {
  const [restaurants, setRestaurants] = useState([]);
  const [userLocation, setUserLocation] = useState(DEFAULT_CENTER);
  const [error, setError] = useState(null);
  // Controlled camera: the Map needs onCameraChanged alongside center/zoom,
  // otherwise it pins the view and panning snaps back.
  const [cameraProps, setCameraProps] = useState({
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
  });

  const findRestaurants = () => {
    setError(null);

    if (!navigator.geolocation) {
      setError("This browser does not support location services.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
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
            const body = await response.json().catch(() => ({}));
            const details = body.details?.length ? `: ${body.details.join(", ")}` : "";
            setError((body.error || "Could not fetch restaurants") + details);
            return;
          }

          const data = await response.json();
          setRestaurants(data.places || []);
        } catch {
          setError("Could not reach the server. Is it running?");
        }
      },
      (positionError) => {
        setError(`Could not get your location: ${positionError.message}`);
      }
    );
  };

  return (
    <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}>
      <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
        <button onClick={findRestaurants} style={{ marginBottom: '20px', padding: '10px' }}>
          Find Food Near Me
        </button>

        {error && (
          <p style={{ color: '#c5221f', marginTop: 0, marginBottom: '20px' }}>{error}</p>
        )}

        <div style={{ height: '600px', width: '100%', borderRadius: '8px', overflow: 'hidden' }}>
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
    </APIProvider>
  );
}
