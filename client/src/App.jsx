import { useEffect, useRef, useState } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin, useMapsLibrary } from '@vis.gl/react-google-maps';
// cmdk's raw Input is what supports `asChild`; the shadcn CommandInput wrapper
// bakes in its own search-icon chrome, which this inline field does not want.
import { Command as CommandPrimitive } from 'cmdk';

import { Button } from '@/components/ui/button';
import { Command, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { DualArc } from './components/loading-ui/dual-arc';

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

/**
 * The address field, and the anchor the suggestion popover positions itself
 * against. Split out from the form purely for readability.
 */
function AddressField({ value, onValueChange, isOpen }) {
  return (
    <PopoverAnchor asChild>
      {/* asChild keeps a real <input> in the form, so Enter still submits
          when no suggestion is highlighted. */}
      <CommandPrimitive.Input asChild value={value} onValueChange={onValueChange}>
        <Input
          id="address"
          type="text"
          // cmdk points aria-labelledby at a hidden label of its own, which
          // would leave the field with no accessible name. The child's props
          // win the Slot merge, so this takes it back.
          aria-labelledby="address-label"
          // Removing cmdk's marker attribute is what stops it pulling focus to
          // the list every time the highlighted option changes. With a
          // debounced remote list that fires on every pause in typing, so the
          // field would lose focus mid-address and swallow the next keystroke.
          // cmdk reads this attribute nowhere else.
          cmdk-input={undefined}
          placeholder="1600 Amphitheatre Pkwy"
          autoComplete="off"
          className="w-80 max-w-full"
          onKeyDown={(event) => {
            // cmdk preventDefaults Enter on the Command root so it can pick the
            // highlighted item, which also swallows the form's implicit
            // submission. With nothing open there is nothing to pick, so
            // submit here instead.
            if (event.key === 'Enter' && !isOpen) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
      </CommandPrimitive.Input>
    </PopoverAnchor>
  );
}

// useMapsLibrary reads APIProvider's context, so it cannot live in the
// component that renders APIProvider — hence this inner component.
function RestaurantFinder() {
  const [restaurants, setRestaurants] = useState([]);
  const [userLocation, setUserLocation] = useState(null); // Don't load map until after location is given
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
    <div className="p-5">
      <Button onClick={findRestaurants} disabled={isSearching}>
        Find Food Near Me
      </Button>

       <form onSubmit={searchByAddress} className="mt-3">
        <Label htmlFor="address" id="address-label" className="mb-1">
          ...or enter an address:
        </Label>

        {/* Command drives the keyboard behaviour (arrows move the highlight,
            Enter picks it); the Popover positions the list against the input.
            shouldFilter is off because the Places API has already filtered --
            cmdk's own fuzzy match would discard perfectly good predictions. */}
        {/* The class overrides undo Command's full-size palette styling; here
            it is only a keyboard-behaviour wrapper around a normal input. */}
        <Command
          shouldFilter={false}
          className="inline-block size-auto overflow-visible bg-transparent p-0 text-inherit"
        >
          <Popover
            open={suggestions.length > 0}
            onOpenChange={(isOpen) => {
              if (!isOpen) setSuggestions([]);
            }}
          >
            <AddressField
              value={address}
              onValueChange={setAddress}
              isOpen={suggestions.length > 0}
            />

            <PopoverContent
              align="start"
              className="w-(--radix-popover-trigger-width) p-0"
              // The list is an extension of the input, so focus has to stay
              // in the input while arrowing through it.
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <CommandList>
                {suggestions.map((text) => (
                  <CommandItem key={text} value={text} onSelect={() => pickSuggestion(text)}>
                    {text}
                  </CommandItem>
                ))}
              </CommandList>
            </PopoverContent>
          </Popover>
        </Command>

        <Button type="submit" disabled={isSearching} className="ml-2">
          Search
        </Button>
      </form>

      {error && <p className="mt-3 text-destructive">{error}</p>}

      {/* This slot holds the map and, on top of it, the searching overlay. The
          two are siblings rather than branches of a ternary so that a repeat
          search leaves the map mounted -- unmounting it would re-instantiate
          the Google map, discarding the user's pan/zoom and billing a fresh
          dynamic map load. On the very first search there is no map underneath
          yet, hence the wrapper appearing as soon as either is showing.
          Note this gates the Map, not the APIProvider above it: Places
          autocomplete needs that context while the user is still typing. */}
      {(isSearching || userLocation) && (
      <div className="relative mt-5 h-[600px] w-full overflow-hidden rounded-lg">
        {userLocation && (
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
        )}

        {/* Covers the map while a search runs: the scrim keeps the spinner
            legible over arbitrary map tiles, and swallowing pointer events
            stops the user panning a map that is about to be re-centered. */}
        {isSearching && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-xs"
          role="status"
          aria-label="Searching for restaurants"
        >
          <DualArc className="size-14" />
        </div>
        )}
      </div>
      )}
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