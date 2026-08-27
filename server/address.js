const ADDRESS_MAX_LENGTH = 250;

/**
 * Validates a free-text address from a request body.
 * Returns an array of human-readable problems; an empty array means valid.
 */
function validateAddress(body) {
  const { address } = body ?? {};
  const details = [];

  if (typeof address !== "string" || address.trim() === "") {
    details.push("address is required and must be a non-empty string");
  } else if (address.length > ADDRESS_MAX_LENGTH) {
    details.push(`address must be ${ADDRESS_MAX_LENGTH} characters or fewer`);
  }

  return details;
}

module.exports = { validateAddress, ADDRESS_MAX_LENGTH };