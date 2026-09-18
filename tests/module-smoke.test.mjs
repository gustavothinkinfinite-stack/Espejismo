import assert from "node:assert/strict";

const registered = new Map();
globalThis.Hooks = {
  once(name, callback) { registered.set(`once:${name}`, callback); },
  on(name, callback) { registered.set(`on:${name}`, callback); }
};

globalThis.game = {
  i18n: { localize: key => key },
  settings: { get: () => true },
  user: { id: "gm", isGM: true }
};
globalThis.canvas = { tokens: { placeables: [], controlled: [] } };
globalThis.foundry = {};

await import("../scripts/main.js");

for (const hook of [
  "once:init",
  "once:ready",
  "on:getSceneControlButtons",
  "on:canvasReady",
  "on:drawToken",
  "on:refreshToken",
  "on:updateToken",
  "on:renderTokenHUD"
]) {
  assert.equal(typeof registered.get(hook), "function", `Missing hook: ${hook}`);
}

console.log("Perception Tokens module smoke test: OK");
