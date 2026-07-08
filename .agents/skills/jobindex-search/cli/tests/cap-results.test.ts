import { describe, test, expect } from "bun:test";
import { capResults } from "../src/helpers";

describe("capResults", () => {
  const items = [1, 2, 3, 4, 5];

  test("caps to a positive limit", () => {
    expect(capResults(items, 3)).toEqual([1, 2, 3]);
  });

  test("returns all items when limit is undefined", () => {
    expect(capResults(items, undefined)).toEqual(items);
  });

  test("regression: a negative limit returns all items, not slice(0, -n)", () => {
    // Array.prototype.slice(0, -1) returns [1,2,3,4] — it counts from the end
    // and silently drops the trailing item. A negative limit is invalid input,
    // so capResults must return the full list instead.
    expect(capResults(items, -1)).toEqual(items);
    expect(capResults(items, -100)).toEqual(items);
  });

  test("a zero limit returns all items", () => {
    expect(capResults(items, 0)).toEqual(items);
  });

  test("NaN returns all items", () => {
    expect(capResults(items, NaN)).toEqual(items);
  });

  test("a limit larger than the list returns all items", () => {
    expect(capResults(items, 999)).toEqual(items);
  });

  test("does not mutate the input array", () => {
    const copy = [...items];
    capResults(items, 2);
    expect(items).toEqual(copy);
  });
});
