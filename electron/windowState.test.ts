import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWindowBounds } from "./windowState.js";

test("window bounds are clamped to secure desktop minimums", () => {
  assert.deepEqual(normalizeWindowBounds({ width: 800, height: 400 }), {
    width: 1180,
    height: 760
  });
});

test("window bounds keep explicit coordinates when present", () => {
  assert.deepEqual(normalizeWindowBounds({ width: 1600, height: 1000, x: 40, y: 80 }), {
    width: 1600,
    height: 1000,
    x: 40,
    y: 80
  });
});
