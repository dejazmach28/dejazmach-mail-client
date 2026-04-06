import assert from "node:assert/strict";
import test from "node:test";
import {
  getEnvironment,
  isAllowedNavigation,
  isAllowedRendererRequest,
  isSafeExternalUrl
} from "./shellPolicy.js";

const developmentPolicy = {
  appUrl: "http://127.0.0.1:5173",
  environment: "development" as const
};

const productionPolicy = {
  appUrl: "file:///app/dist/index.html",
  environment: "production" as const
};

test("safe external URLs allow https and mailto only", () => {
  assert.equal(isSafeExternalUrl("https://example.com"), true);
  assert.equal(isSafeExternalUrl("mailto:team@example.com"), true);
  assert.equal(isSafeExternalUrl("http://example.com"), false);
  assert.equal(isSafeExternalUrl("javascript:alert(1)"), false);
});

test("navigation stays local to the app shell", () => {
  assert.equal(isAllowedNavigation("http://127.0.0.1:5173/inbox", developmentPolicy), true);
  assert.equal(isAllowedNavigation("https://example.com", developmentPolicy), false);
  assert.equal(isAllowedNavigation("file:///app/dist/index.html", productionPolicy), true);
});

test("renderer requests stay embedded or same-origin", () => {
  assert.equal(isAllowedRendererRequest("data:image/png;base64,abc", productionPolicy), true);
  assert.equal(isAllowedRendererRequest("blob:https://example.com/123", productionPolicy), true);
  assert.equal(isAllowedRendererRequest("https://tracker.example.com/pixel", productionPolicy), false);
  assert.equal(isAllowedRendererRequest("http://127.0.0.1:5173/src/main.tsx", developmentPolicy), true);
});

test("environment detection treats packaged apps as production", () => {
  assert.equal(getEnvironment(false, "http://127.0.0.1:5173"), "development");
  assert.equal(getEnvironment(true, "http://127.0.0.1:5173"), "production");
  assert.equal(getEnvironment(false), "production");
});
