import { useState } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin } from '@vis.gl/react-google-maps';

export default function App() {
  const [restaurants, setRestaurants] = useState([]);
  const [userLocation, setUserLocation] = useState({ lat: 37.7749, lng: -122.4194 });

  const findRestaurants = () => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(async (position) => {
      const { latitude, longitude } = position.coords;
      setUserLocation({ lat: latitude, lng: longitude });

      // Call your local Node server, NOT Google
      const response = await fetch("http://localhost:3001/api/restaurants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude, longitude })
      });

      const data = await response.json();
      setRestaurants(data.places || []);
    });
  };

  return (
    <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}>
      <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
        <button onClick={findRestaurants} style={{ marginBottom: '20px', padding: '10px' }}>
          Find Food Near Me
        </button>

        <div style={{ height: '600px', width: '100%', borderRadius: '8px', overflow: 'hidden' }}>
          <Map defaultZoom={13} center={userLocation} mapId="DEMO_MAP_ID">
            
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