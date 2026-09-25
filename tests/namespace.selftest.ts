import assert from "node:assert/strict";
import {
  effectiveMcpNamespace,
  legacyMcpNamespace,
  mcpServerSchema,
  normalizeMcpNamespace,
} from "../shared/config";

assert.equal(normalizeMcpNamespace(" o8 "), "o8");
assert.equal(normalizeMcpNamespace("RK3588 16G"), "rk3588-16g");
assert.equal(legacyMcpNamespace("mcp-MughKku7-0zfnnu"), "paseo-mcp-mughkku7-0zfnnu");
assert.equal(
  effectiveMcpNamespace({ id: "mcp-MughKku7-0zfnnu", namespace: "" }),
  "paseo-mcp-mughkku7-0zfnnu",
);
assert.equal(
  effectiveMcpNamespace({ id: "mcp-MughKku7-0zfnnu", namespace: " O8 " }),
  "o8",
);
assert.equal(
  legacyMcpNamespace("X".repeat(80)),
  `paseo-${"x".repeat(80)}`,
);
assert.equal(
  mcpServerSchema.parse({
    id: "legacy-id",
    name: "legacy",
    url: "https://example.com/mcp",
  }).namespace,
  "",
);

console.log("namespace self-test passed");
