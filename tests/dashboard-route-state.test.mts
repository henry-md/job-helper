import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDashboardHref,
  parseDashboardRouteState,
  parseDashboardRouteStateFromSearchParams,
} from "../lib/dashboard-route-state.ts";

test("dashboard route state defaults to the new-application workspace", () => {
  assert.deepEqual(parseDashboardRouteState(), {
    tab: "new",
    tailoredResumeId: null,
  });
});

test("dashboard route state keeps a tailored resume review id only on the tailor tab", () => {
  assert.deepEqual(
    parseDashboardRouteState({
      tab: "tailor",
      tailoredResumeId: " tailored-123 ",
    }),
    {
      tab: "tailor",
      tailoredResumeId: "tailored-123",
    },
  );

  assert.deepEqual(
    parseDashboardRouteState({
      tab: "new",
      tailoredResumeId: "tailored-123",
    }),
    {
      tab: "new",
      tailoredResumeId: null,
    },
  );
});

test("dashboard route state reads review state from URL search params", () => {
  assert.deepEqual(
    parseDashboardRouteStateFromSearchParams(
      new URLSearchParams({
        tab: "tailor",
        tailoredResumeId: "tailored-456",
      }),
    ),
    {
      tab: "tailor",
      tailoredResumeId: "tailored-456",
    },
  );
});

test("dashboard href builder creates stable deep links for tailor review state", () => {
  assert.equal(buildDashboardHref({ tab: "new" }), "/dashboard");
  assert.equal(buildDashboardHref({ tab: "tailor" }), "/dashboard?tab=tailor");
  assert.equal(
    buildDashboardHref({
      tab: "tailor",
      tailoredResumeId: "tailored-789",
    }),
    "/dashboard?tab=tailor&tailoredResumeId=tailored-789",
  );
});
