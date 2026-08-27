const test = require("node:test");
const assert = require("node:assert/strict");

const { validateCoordinates } = require("../coordinates");

test.describe("validateCoordinates", () => {
  test("accepts a normal coordinate pair", () => {
    assert.deepEqual(validateCoordinates({ latitude: 37.77, longitude: -122.42 }), []);
  });

  test("accepts 0, 0 (the falsy-check trap)", () => {
    // `if (!latitude)` would wrongly reject the equator / prime meridian.
    assert.deepEqual(validateCoordinates({ latitude: 0, longitude: 0 }), []);
  });

  test("accepts the exact range boundaries", () => {
    assert.deepEqual(validateCoordinates({ latitude: 90, longitude: 180 }), []);
    assert.deepEqual(validateCoordinates({ latitude: -90, longitude: -180 }), []);
  });

  test("reports both fields when both are missing", () => {
    const details = validateCoordinates({});

    assert.equal(details.length, 2);
    assert.ok(details.some((d) => d.includes("latitude")));
    assert.ok(details.some((d) => d.includes("longitude")));
  });

  test("reports only the offending field", () => {
    const details = validateCoordinates({ latitude: 37.77 });

    assert.equal(details.length, 1);
    assert.ok(details[0].includes("longitude"));
  });

  test("handles an undefined or null body without throwing", () => {
    assert.equal(validateCoordinates(undefined).length, 2);
    assert.equal(validateCoordinates(null).length, 2);
  });

  test.describe("rejects non-numeric values", () => {
    const badValues = [
      ["numeric string", "37.77"],
      ["empty string", ""],
      ["null", null],
      ["boolean", true],
      ["NaN", NaN],
      ["Infinity", Infinity],
      ["array", [37.77]],
      ["object", { value: 37.77 }],
    ];

    for (const [label, value] of badValues) {
      test(label, () => {
        const details = validateCoordinates({ latitude: value, longitude: value });
        assert.equal(details.length, 2, `expected ${label} to be rejected`);
      });
    }
  });

  test.describe("rejects out-of-range values", () => {
    const outOfRange = [
      ["latitude above 90", { latitude: 90.1, longitude: 0 }, "latitude"],
      ["latitude below -90", { latitude: -90.1, longitude: 0 }, "latitude"],
      ["longitude above 180", { latitude: 0, longitude: 180.1 }, "longitude"],
      ["longitude below -180", { latitude: 0, longitude: -180.1 }, "longitude"],
      ["swapped pair", { latitude: 122.42, longitude: 37.77 }, "latitude"],
    ];

    for (const [label, body, expectedField] of outOfRange) {
      test(label, () => {
        const details = validateCoordinates(body);
        assert.equal(details.length, 1);
        assert.ok(details[0].includes(expectedField));
      });
    }
  });
});
