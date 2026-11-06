import { describe, expect, it } from "vitest";
import { prepareSpendingFlow } from "#/lib/spending-flow";

describe("prepareSpendingFlow", () => {
  it("drops a category's self-repeat when it is the category's only band", () => {
    const flow = prepareSpendingFlow(
      [
        { name: "Bank", color: "#94a3b8" },
        { name: "Groceries", color: "#16a34a" },
        { name: "Groceries", color: "#16a34a" },
      ],
      [
        { source: 0, target: 1, value: 5000 },
        { source: 1, target: 2, value: 5000 },
      ],
    );

    expect(flow.nodes.map((node) => node.name)).toEqual(["Bank", "Groceries"]);
    expect(flow.links).toEqual([{ source: 0, target: 1, value: 5000 }]);
    expect(flow.columns).toBe(2);
    expect(flow.totalSpent).toBe(5000);
  });

  it("keeps the self-repeat next to real subcategories and computes shares", () => {
    const flow = prepareSpendingFlow(
      [
        { name: "Bank" },
        { name: "Food", color: "#f97316" },
        { name: "Food", color: "#f97316" },
        { name: "Restaurants", color: "#fb923c" },
      ],
      [
        { source: 0, target: 1, value: 10000 },
        { source: 1, target: 2, value: 4000 },
        { source: 1, target: 3, value: 6000 },
      ],
    );

    expect(flow.nodes).toHaveLength(4);
    expect(flow.columns).toBe(3);
    const restaurants = flow.nodes.find((node) => node.name === "Restaurants");
    expect(restaurants?.depth).toBe(2);
    expect(restaurants?.total).toBe(6000);
    expect(restaurants?.share).toBeCloseTo(0.6);
  });

  it("returns an empty flow when every band is zero", () => {
    const flow = prepareSpendingFlow(
      [{ name: "Bank" }, { name: "Rent" }],
      [{ source: 0, target: 1, value: 0 }],
    );

    expect(flow.links).toEqual([]);
    expect(flow.nodes).toEqual([]);
    expect(flow.largestColumn).toBe(0);
  });
});
