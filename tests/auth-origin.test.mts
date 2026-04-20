import assert from "node:assert/strict";
import test from "node:test";
import {
  isLocalhostOrigin,
  normalizeAuthOrigin,
  resolveAuthOrigin,
  shouldTrustAuthHost,
} from "../lib/auth-origin.ts";

test("normalizeAuthOrigin keeps explicit origins and upgrades bare hosts to https", () => {
  assert.equal(
    normalizeAuthOrigin("https://job-helper.example.com/dashboard"),
    "https://job-helper.example.com",
  );
  assert.equal(
    normalizeAuthOrigin("job-helper.up.railway.app"),
    "https://job-helper.up.railway.app",
  );
  assert.equal(normalizeAuthOrigin(""), null);
});

test("isLocalhostOrigin recognizes common local auth hosts", () => {
  assert.equal(isLocalhostOrigin("http://localhost:3000"), true);
  assert.equal(isLocalhostOrigin("http://127.0.0.1:3000"), true);
  assert.equal(isLocalhostOrigin("https://job-helper.example.com"), false);
});

test("resolveAuthOrigin prefers the deployed host over a stale localhost NEXTAUTH_URL in production", () => {
  const resolvedOrigin = resolveAuthOrigin({
    NEXTAUTH_URL: "http://localhost:3000",
    NODE_ENV: "production",
    RAILWAY_PUBLIC_DOMAIN: "job-helper.up.railway.app",
  });

  assert.equal(resolvedOrigin, "https://job-helper.up.railway.app");
});

test("resolveAuthOrigin keeps an explicit production NEXTAUTH_URL when it is already correct", () => {
  const resolvedOrigin = resolveAuthOrigin({
    NEXTAUTH_URL: "https://jobs.example.com",
    NODE_ENV: "production",
    RAILWAY_PUBLIC_DOMAIN: "job-helper.up.railway.app",
  });

  assert.equal(resolvedOrigin, "https://jobs.example.com");
});

test("shouldTrustAuthHost defaults on in production and respects explicit configuration", () => {
  assert.equal(shouldTrustAuthHost({ NODE_ENV: "production" }), true);
  assert.equal(
    shouldTrustAuthHost({ AUTH_TRUST_HOST: "false", NODE_ENV: "production" }),
    false,
  );
  assert.equal(
    shouldTrustAuthHost({ AUTH_TRUST_HOST: "true", NODE_ENV: "development" }),
    true,
  );
  assert.equal(shouldTrustAuthHost({ NODE_ENV: "development" }), false);
});
