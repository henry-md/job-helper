import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDashboardHref,
  parseDashboardRouteState,
  parseDashboardRouteStateFromSearchParams,
} from "../lib/dashboard-route-state.ts";

test("dashboard route state defaults to the config workspace", () => {
  assert.deepEqual(parseDashboardRouteState(), {
    tab: "config",
    tailoredResumeId: null,
  });
});

test("dashboard route state keeps a tailored resume review id only on the saved tab", () => {
  assert.deepEqual(
    parseDashboardRouteState({
      tab: "saved",
      tailoredResumeId: " tailored-123 ",
    }),
    {
      tab: "saved",
      tailoredResumeId: "tailored-123",
    },
  );

  assert.deepEqual(
    parseDashboardRouteState({
      tab: "tailor",
      tailoredResumeId: "tailored-123",
    }),
    {
      tab: "saved",
      tailoredResumeId: "tailored-123",
    },
  );

  assert.deepEqual(
    parseDashboardRouteState({
      tab: "new",
    }),
    {
      tab: "saved",
      tailoredResumeId: null,
    },
  );

  assert.deepEqual(
    parseDashboardRouteState({
      tab: "settings",
      tailoredResumeId: "tailored-123",
    }),
    {
      tab: "settings",
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
      tab: "saved",
      tailoredResumeId: "tailored-456",
    },
  );
});

test("dashboard href builder creates stable deep links for tailor review state", () => {
  assert.equal(buildDashboardHref({ tab: "config" }), "/dashboard");
  assert.equal(buildDashboardHref({ tab: "saved" }), "/dashboard?tab=saved");
  assert.equal(
    buildDashboardHref({ tab: "settings" }),
    "/dashboard?tab=settings",
  );
  assert.equal(
    buildDashboardHref({
      tab: "saved",
      tailoredResumeId: "tailored-789",
    }),
    "/dashboard?tab=saved&tailoredResumeId=tailored-789",
  );
});
