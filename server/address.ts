const ADDRESS_MAX_LENGTH = 250;

/** A request body as it arrives: untrusted, so every field is `unknown`. */
interface AddressBody {
  address?: unknown;
}

/**
 * Validates a free-text address from a request body.
 * Returns an array of human-readable problems; an empty array means valid.
 */
function validateAddress(body: AddressBody | null | undefined): string[] {
  const { address } = body ?? {};
  const details: string[] = [];

  if (typeof address !== "string" || address.trim() === "") {
    details.push("address is required and must be a non-empty string");
  } else if (address.length > ADDRESS_MAX_LENGTH) {
    details.push(`address must be ${ADDRESS_MAX_LENGTH} characters or fewer`);
  }

  return details;
}

export { validateAddress, ADDRESS_MAX_LENGTH };