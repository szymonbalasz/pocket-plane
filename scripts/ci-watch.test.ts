import { expect, test } from "bun:test";
import { latestPerWorkflow, verdict } from "./ci-watch";

const run = (id: number, workflowName: string, conclusion: string) => ({
  databaseId: id,
  workflowName,
  status: "completed",
  conclusion,
  url: `https://example.test/${id}`,
});

test("ci:watch: a re-run replaces the older attempt of the same workflow", () => {
  const runs = latestPerWorkflow([
    run(1, "ci", "failure"),
    run(3, "ci", "success"),
    run(2, "nightly", "success"),
  ]);
  expect(runs.map((r) => r.databaseId).sort()).toEqual([2, 3]);
});

test("ci:watch: verdict — any failure fails, all cancelled is superseded, else green", () => {
  expect(verdict([run(1, "ci", "success"), run(2, "x", "skipped")])).toBe("green");
  expect(verdict([run(1, "ci", "success"), run(2, "x", "failure")])).toBe("failed");
  expect(verdict([run(1, "ci", "timed_out")])).toBe("failed");
  expect(verdict([run(1, "ci", "cancelled")])).toBe("superseded");
  expect(verdict([run(1, "ci", "cancelled"), run(2, "x", "success")])).toBe("green");
});
