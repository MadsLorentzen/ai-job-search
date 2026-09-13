import { describe, expect, test } from "bun:test";
import { filterAutocompleteGroups } from "../src/commands/autocomplete";

function groups() {
  return [
    {
      title: "Stillingsbetegnelser",
      items: [
        { id: "1", text: "Data Engineer", value: 11, category: "title", slug: "data-engineer" },
        { id: "2", text: "Dataanalytiker", value: 12, category: "title", slug: "dataanalytiker" },
      ],
    },
    {
      title: "Kategorier",
      items: [{ id: "3", text: "Marketing", value: 21, category: "category", slug: "marketing" }],
    },
  ];
}

describe("jobdanmark autocomplete filtering", () => {
  test("keeps only items matching the query, drops empty groups", () => {
    const out = filterAutocompleteGroups(groups(), "data");
    expect(out).toHaveLength(1);
    expect(out[0].items.map((i) => i.text)).toEqual(["Data Engineer", "Dataanalytiker"]);
  });

  test("tolerates a group with missing items (pins the existing ?? [] guard)", () => {
    const g = groups();
    // @ts-expect-error - the cast API response can omit fields the interface promises
    delete g[1].items;
    expect(filterAutocompleteGroups(g, "data")).toHaveLength(1);
  });

  // The API response reaches this code through a bare type cast
  // (apiFetch<AutocompleteGroup[]>), so an item without text arrives typed as
  // if it had one. The unguarded filter threw TypeError from
  // item.text.toLowerCase() and the whole command died as API_ERROR (#421).
  // An item with no usable text can never match the (required, non-empty)
  // query, so it must simply be skipped.
  test("skips an item with null text instead of crashing the command", () => {
    const g = groups();
    g[0].items.push({ id: "4", text: null as unknown as string, value: 13, category: "title", slug: "x" });

    const out = filterAutocompleteGroups(g, "data");

    expect(out[0].items.map((i) => i.slug)).toEqual(["data-engineer", "dataanalytiker"]);
  });
});
