import assert from "node:assert/strict";

const registered = new Map();
globalThis.Hooks = {
  once(name, callback) { registered.set(`once:${name}`, callback); },
  on(name, callback) { registered.set(`on:${name}`, callback); }
};

globalThis.game = {
  i18n: { localize: key => key },
  settings: {
    get: () => true,
    register: () => undefined
  },
  user: { id: "player-a", isGM: false }
};
globalThis.canvas = { tokens: { placeables: [], controlled: [] } };
globalThis.foundry = {};

await import("../scripts/main.js");
registered.get("once:ready")();

let resizeArgs = null;
const originalTexture = { id: "real" };
const token = {
  w: 100,
  h: 80,
  isVisible: true,
  texture: originalTexture,
  mesh: {
    texture: originalTexture,
    alpha: 1,
    visible: true,
    resize(width, height, options) {
      resizeArgs = { width, height, options };
    }
  },
  nameplate: { text: "Goblin" },
  document: {
    documentName: "Token",
    name: "Goblin",
    alpha: 1,
    texture: { scaleX: 1, scaleY: 1 },
    getFlag: () => ({
      enabled: true,
      viewers: {
        "player-a": {
          enabled: true,
          image: "",
          name: "Humano",
          scale: 3,
          opacity: 1,
          hidden: false
        }
      }
    })
  }
};

await globalThis.Espejismo.applyToToken(token);

assert.deepEqual(resizeArgs, {
  width: 100,
  height: 80,
  options: {
    fit: "contain",
    scaleX: 3,
    scaleY: 3
  }
});
assert.equal(token.nameplate.text, "Humano");

console.log("Espejismo scale test: OK");
