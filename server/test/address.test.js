const test = require("node:test");
const assert = require("node:assert/strict");

const { validateAddress, ADDRESS_MAX_LENGTH } = require("../address");

test.describe("validateAddress", () => {
  test("accepts a normal address", () => {
    assert.deepEqual(validateAddress({ address: "1600 Amphitheatre Pkwy" }), []);
  });

  test("accepts an address at the exact length limit", () => {
    assert.deepEqual(validateAddress({ address: "a".repeat(ADDRESS_MAX_LENGTH) }), []);
  });

  test("accepts an address with surrounding whitespace", () => {
    assert.deepEqual(validateAddress({ address: "  Zuni Cafe  " }), []);
  });

  test("rejects an address one character over the limit", () => {
    const details = validateAddress({ address: "a".repeat(ADDRESS_MAX_LENGTH + 1) });

    assert.equal(details.length, 1);
    assert.ok(details[0].includes(String(ADDRESS_MAX_LENGTH)));
  });

  test("handles an undefined or null body without throwing", () => {
    assert.equal(validateAddress(undefined).length, 1);
    assert.equal(validateAddress(null).length, 1);
  });

  test.describe("rejects missing or non-string values", () => {
    const badValues = [
      ["missing", undefined],
      ["empty string", ""],
      ["whitespace only", "   "],
      ["null", null],
      ["number", 94110],
      ["boolean", true],
      ["array", ["1600 Amphitheatre Pkwy"]],
      ["object", { value: "1600 Amphitheatre Pkwy" }],
    ];

    for (const [label, value] of badValues) {
      test(label, () => {
        const details = validateAddress({ address: value });

        assert.equal(details.length, 1, `expected ${label} to be rejected`);
        assert.ok(details[0].includes("address"));
      });
    }
  });
});