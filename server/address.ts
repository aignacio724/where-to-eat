export const ADDRESS_MAX_LENGTH = 250;

/**
 * Validates a free-text address from a request body.
 * Returns an array of human-readable problems; an empty array means valid.
 */
export function validateAddress(body: unknown): string[] {
  const { address } = (body ?? {}) as { address?: unknown };
  const details: string[] = [];

  if (typeof address !== "string" || address.trim() === "") {
    details.push("address is required and must be a non-empty string");
  } else if (address.length > ADDRESS_MAX_LENGTH) {
    details.push(`address must be ${ADDRESS_MAX_LENGTH} characters or fewer`);
  }

  return details;
}
