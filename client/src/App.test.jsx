import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from './App.jsx';

/**
 * Stub the Google bindings. Without this, APIProvider tries to inject the Maps
 * JS script tag, which jsdom cannot load and which would make these tests
 * depend on a real API key.
 */
const mockFetchSuggestions = vi.fn();

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }) => children,
  Map: ({ children }) => <div data-testid="map">{children}</div>,
  // Only restaurant markers carry a title; the user's pin does not. Splitting
  // them here keeps the counts in the tests unambiguous.
  AdvancedMarker: ({ title, children }) => (
    <div data-testid={title ? 'restaurant-marker' : 'user-marker'} data-title={title}>
      {children}
    </div>
  ),
  Pin: () => <div data-testid="pin" />,
  useMapsLibrary: () => ({
    AutocompleteSuggestion: {
      fetchAutocompleteSuggestions: (...args) => mockFetchSuggestions(...args),
    },
  }),
}));

const SF = { latitude: 37.7749, longitude: -122.4194 };

const PLACES_BODY = {
  places: [
    {
      displayName: { text: 'Tartine Bakery' },
      location: { latitude: 37.7614, longitude: -122.4241 },
    },
    {
      displayName: { text: 'Zuni Cafe' },
      location: { latitude: 37.7735, longitude: -122.4222 },
    },
  ],
};

/** Builds a Response-like object for the two fields App.jsx reads. */
function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

/** Routes a mocked fetch by URL so a test can answer each endpoint separately. */
function mockRoutes({ geocode, restaurants }) {
  return vi.fn(async (url) => {
    if (url === '/api/geocode') return geocode ?? jsonResponse({ ...SF });
    if (url === '/api/restaurants') return restaurants ?? jsonResponse(PLACES_BODY);
    throw new Error(`unexpected fetch to ${url}`);
  });
}

/** Installs a geolocation that succeeds with `coords`. */
function grantGeolocation(coords = SF) {
  const getCurrentPosition = vi.fn((onSuccess) => onSuccess({ coords }));
  vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });
  return getCurrentPosition;
}

/** Installs a geolocation that invokes the error callback, as a denial does. */
function denyGeolocation(message = 'User denied Geolocation') {
  const getCurrentPosition = vi.fn((onSuccess, onError) => onError({ message }));
  vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });
  return getCurrentPosition;
}

const findButton = () => screen.getByRole('button', { name: /find food near me/i });
const searchButton = () => screen.getByRole('button', { name: /^search$/i });
const addressInput = () => screen.getByLabelText(/enter an address/i);

beforeEach(() => {
  mockFetchSuggestions.mockReset();
  mockFetchSuggestions.mockResolvedValue({ suggestions: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('geolocation path', () => {
  test('searches restaurants at the reported coordinates', async () => {
    grantGeolocation();
    const fetchMock = mockRoutes({});
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await userEvent.click(findButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/restaurants', expect.anything()));

    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/restaurants');
    expect(JSON.parse(init.body)).toEqual(SF);
  });

  test('renders a marker per returned restaurant, plus the user pin', async () => {
    grantGeolocation();
    vi.stubGlobal('fetch', mockRoutes({}));

    render(<App />);
    await userEvent.click(findButton());

    await waitFor(() => expect(screen.getAllByTestId('restaurant-marker')).toHaveLength(2));
    expect(screen.getByTestId('user-marker')).toBeInTheDocument();
    expect(screen.getByTestId('pin')).toBeInTheDocument();
  });

  test('shows a recoverable message when the user denies permission', async () => {
    denyGeolocation();
    const fetchMock = mockRoutes({});
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await userEvent.click(findButton());

    // The message must point at the address box, which is the whole
    // reason that fallback exists.
    expect(await screen.findByText(/enter an address instead/i)).toBeInTheDocument();
    expect(screen.getByText(/user denied geolocation/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('shows a message when the browser has no geolocation at all', async () => {
    vi.stubGlobal('navigator', { ...navigator, geolocation: undefined });
    vi.stubGlobal('fetch', mockRoutes({}));

    render(<App />);
    await userEvent.click(findButton());

    expect(
      await screen.findByText(/does not support location services/i)
    ).toBeInTheDocument();
  });

  test('re-enables the buttons after a denial so the user is not stuck', async () => {
    denyGeolocation();
    vi.stubGlobal('fetch', mockRoutes({}));

    render(<App />);
    await userEvent.click(findButton());

    await screen.findByText(/enter an address instead/i);
    expect(findButton()).toBeEnabled();
    expect(searchButton()).toBeEnabled();
  });
});

describe('address path', () => {
  test('geocodes the address, then searches with the returned coordinates', async () => {
    const fetchMock = mockRoutes({});
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await userEvent.type(addressInput(), '1600 Amphitheatre Pkwy');
    await userEvent.click(searchButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/restaurants', expect.anything()));

    const [, geocodeInit] = fetchMock.mock.calls.find(([url]) => url === '/api/geocode');
    expect(JSON.parse(geocodeInit.body)).toEqual({ address: '1600 Amphitheatre Pkwy' });

    const [, searchInit] = fetchMock.mock.calls.find(([url]) => url === '/api/restaurants');
    expect(JSON.parse(searchInit.body)).toEqual(SF);
  });

  test('works without geolocation ever being granted', async () => {
    denyGeolocation();
    vi.stubGlobal('fetch', mockRoutes({}));

    render(<App />);
    await userEvent.click(findButton());
    await screen.findByText(/enter an address instead/i);

    // The denial must not poison the address path.
    await userEvent.type(addressInput(), '1600 Amphitheatre Pkwy');
    await userEvent.click(searchButton());

    await waitFor(() => expect(screen.getAllByTestId('restaurant-marker')).toHaveLength(2));
  });

  test('refuses to submit an empty address without calling the server', async () => {
    const fetchMock = mockRoutes({});
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await userEvent.click(searchButton());

    expect(await screen.findByText(/enter an address to search/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('submits on Enter as well as the button', async () => {
    const fetchMock = mockRoutes({});
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await userEvent.type(addressInput(), '1600 Amphitheatre Pkwy{Enter}');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/geocode', expect.anything()));
  });
});

describe('server error handling', () => {
  test("surfaces the server's message when an address has no results", async () => {
    vi.stubGlobal('fetch', mockRoutes({
      geocode: jsonResponse({ error: 'No results found for that address' }, { ok: false, status: 404 }),
    }));

    render(<App />);
    await userEvent.type(addressInput(), 'asdfghjkl qwerty');
    await userEvent.click(searchButton());

    expect(await screen.findByText(/no results found for that address/i)).toBeInTheDocument();
  });

  test('surfaces the rate limiter message on a 429', async () => {
    vi.stubGlobal('fetch', mockRoutes({
      geocode: jsonResponse(
        { error: 'Too many requests. Please wait a moment and try again.' },
        { ok: false, status: 429 }
      ),
    }));

    render(<App />);
    await userEvent.type(addressInput(), '1600 Amphitheatre Pkwy');
    await userEvent.click(searchButton());

    expect(await screen.findByText(/too many requests/i)).toBeInTheDocument();
  });

  test('appends validation details to the error message', async () => {
    vi.stubGlobal('fetch', mockRoutes({
      geocode: jsonResponse(
        { error: 'Invalid address', details: ['address is required and must be a non-empty string'] },
        { ok: false, status: 400 }
      ),
    }));

    render(<App />);
    await userEvent.type(addressInput(), 'x'.repeat(5));
    await userEvent.click(searchButton());

    expect(await screen.findByText(/invalid address: address is required/i)).toBeInTheDocument();
  });

  test('reports a network failure instead of throwing an unhandled rejection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('NetworkError when attempting to fetch resource.');
    }));

    render(<App />);
    await userEvent.type(addressInput(), '1600 Amphitheatre Pkwy');
    await userEvent.click(searchButton());

    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
  });

  test('falls back to a generic message when the error body is unreadable', async () => {
    vi.stubGlobal('fetch', mockRoutes({
      geocode: {
        ok: false,
        status: 500,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      },
    }));

    render(<App />);
    await userEvent.type(addressInput(), '1600 Amphitheatre Pkwy');
    await userEvent.click(searchButton());

    expect(await screen.findByText(/could not look up that address/i)).toBeInTheDocument();
  });

  test('clears a previous error when a new search starts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'No results found for that address' }, { ok: false, status: 404 }))
      .mockResolvedValue(jsonResponse({ ...SF }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await userEvent.type(addressInput(), 'asdfghjkl');
    await userEvent.click(searchButton());
    await screen.findByText(/no results found/i);

    fetchMock.mockResolvedValue(jsonResponse(PLACES_BODY));
    await userEvent.click(searchButton());

    await waitFor(() =>
      expect(screen.queryByText(/no results found/i)).not.toBeInTheDocument()
    );
  });
});

describe('autocomplete guards', () => {
  /**
   * These run on real timers. Faking the clock is the obvious approach, but
   * userEvent's typing loop deadlocks against a faked clock here, and the
   * debounce is only 300ms -- cheap enough to simply wait out.
   *
   * `delay: null` removes userEvent's inter-keystroke pause, so a whole
   * string lands well inside one debounce window.
   */
  const typist = () => userEvent.setup({ delay: null });
  const pastDebounce = () => new Promise((resolve) => setTimeout(resolve, 400));

  test('does not call the API for one- or two-character input', async () => {
    const user = typist();
    vi.stubGlobal('fetch', mockRoutes({}));

    render(<App />);
    await user.type(addressInput(), 'ab');
    await act(pastDebounce);

    // This is the billing guard: short prefixes must cost nothing.
    expect(mockFetchSuggestions).not.toHaveBeenCalled();
  });

  test('calls the API once the third character is typed', async () => {
    const user = typist();
    vi.stubGlobal('fetch', mockRoutes({}));

    render(<App />);
    await user.type(addressInput(), 'abc');

    await waitFor(() => expect(mockFetchSuggestions).toHaveBeenCalledWith({ input: 'abc' }));
  });

  test('debounces rapid typing into a single request', async () => {
    const user = typist();
    vi.stubGlobal('fetch', mockRoutes({}));

    render(<App />);
    await user.type(addressInput(), '1368 daphne');
    await act(pastDebounce);

    // Without the debounce this would be one request per keystroke.
    expect(mockFetchSuggestions).toHaveBeenCalledTimes(1);
    expect(mockFetchSuggestions).toHaveBeenCalledWith({ input: '1368 daphne' });
  });

  test('clears suggestions when the input drops below the minimum', async () => {
    const user = typist();
    vi.stubGlobal('fetch', mockRoutes({}));
    mockFetchSuggestions.mockResolvedValue({
      suggestions: [{ placePrediction: { text: { text: '1368 Daphne Dr, San Jose, CA, USA' } } }],
    });

    render(<App />);
    await user.type(addressInput(), 'abc');
    await screen.findByRole('button', { name: /1368 Daphne Dr/i });

    await user.clear(addressInput());
    await user.type(addressInput(), 'a');

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /1368 Daphne Dr/i })).not.toBeInTheDocument()
    );
  });
});

describe('autocomplete behaviour', () => {
  test('renders returned predictions as clickable options', async () => {
    mockFetchSuggestions.mockResolvedValue({
      suggestions: [
        { placePrediction: { text: { text: '1368 Daphne Dr, San Jose, CA, USA' } } },
        { placePrediction: { text: { text: '1368 Daphne Ct, East Palo Alto, CA, USA' } } },
      ],
    });
    vi.stubGlobal('fetch', mockRoutes({}));

    render(<App />);
    await userEvent.type(addressInput(), '1368 daphne');

    expect(await screen.findByRole('button', { name: /1368 Daphne Dr/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1368 Daphne Ct/i })).toBeInTheDocument();
  });

  test('picking a suggestion fills the input and closes the dropdown', async () => {
    mockFetchSuggestions.mockResolvedValue({
      suggestions: [{ placePrediction: { text: { text: '1368 Daphne Dr, San Jose, CA, USA' } } }],
    });
    vi.stubGlobal('fetch', mockRoutes({}));

    render(<App />);
    await userEvent.type(addressInput(), '1368 daphne');
    await userEvent.click(await screen.findByRole('button', { name: /1368 Daphne Dr/i }));

    expect(addressInput()).toHaveValue('1368 Daphne Dr, San Jose, CA, USA');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /1368 Daphne Dr/i })).not.toBeInTheDocument()
    );
  });

  test('picking a suggestion does not trigger another API call', async () => {
    mockFetchSuggestions.mockResolvedValue({
      suggestions: [{ placePrediction: { text: { text: '1368 Daphne Dr, San Jose, CA, USA' } } }],
    });
    vi.stubGlobal('fetch', mockRoutes({}));

    render(<App />);
    await userEvent.type(addressInput(), '1368 daphne');
    await screen.findByRole('button', { name: /1368 Daphne Dr/i });

    const callsBefore = mockFetchSuggestions.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: /1368 Daphne Dr/i }));

    // Filling the input from a pick must not look like fresh typing.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(mockFetchSuggestions.mock.calls.length).toBe(callsBefore);
  });

  test('a suggestions failure still leaves the address searchable', async () => {
    mockFetchSuggestions.mockRejectedValue(new Error('places unavailable'));
    const fetchMock = mockRoutes({});
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await userEvent.type(addressInput(), '1600 Amphitheatre Pkwy');
    await userEvent.click(searchButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/geocode', expect.anything()));
  });

  test('drops predictions with no usable text', async () => {
    mockFetchSuggestions.mockResolvedValue({
      suggestions: [
        { placePrediction: { text: { text: '1368 Daphne Dr, San Jose, CA, USA' } } },
        { placePrediction: null },
        {},
      ],
    });
    vi.stubGlobal('fetch', mockRoutes({}));

    render(<App />);
    await userEvent.type(addressInput(), '1368 daphne');

    await screen.findByRole('button', { name: /1368 Daphne Dr/i });
    // Only the usable one renders; the malformed entries are filtered out.
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
});
