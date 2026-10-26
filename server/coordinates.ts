const LATITUDE_MIN = -90;
const LATITUDE_MAX = 90;
const LONGITUDE_MIN = -180;
const LONGITUDE_MAX = 180;

/** A request body as it arrives: untrusted, so every field is `unknown`. */
interface CoordinatesBody {
  latitude?: unknown;
  longitude?: unknown;
}

// The typeof check narrows `value` for the comparisons, but on its own it is
// not enough: `typeof NaN === "number"`, so Number.isFinite is the real check
// here. It also rejects Infinity.
function isFiniteNumberInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Validates a latitude/longitude pair from a request body.
 * Returns an array of human-readable problems; an empty array means valid.
 */
function validateCoordinates(body: CoordinatesBody | null | undefined): string[] {
  const { latitude, longitude } = body ?? {};
  const details: string[] = [];

  if (!isFiniteNumberInRange(latitude, LATITUDE_MIN, LATITUDE_MAX)) {
    details.push(
      `latitude is required and must be a number between ${LATITUDE_MIN} and ${LATITUDE_MAX}`
    );
  }

  if (!isFiniteNumberInRange(longitude, LONGITUDE_MIN, LONGITUDE_MAX)) {
    details.push(
      `longitude is required and must be a number between ${LONGITUDE_MIN} and ${LONGITUDE_MAX}`
    );
  }

  return details;
}

export { validateCoordinates };
