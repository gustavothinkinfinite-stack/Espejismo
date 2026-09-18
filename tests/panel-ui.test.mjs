import assert from "node:assert/strict";

const registered = new Map();
let dialogContent = "";
let registeredKeybinding = null;

globalThis.Hooks = {
  once(name, callback) { registered.set(`once:${name}`, callback); },
  on(name, callback) { registered.set(`on:${name}`, callback); }
};

class DialogMock {
  constructor(data) {
    this.data = data;
    this.rendered = false;
    dialogContent = data.content;
  }

  render() {
    this.rendered = true;
    dialogContent = this.data.content;
  }
}

const token = {
  id: "token-a",
  name: "Goblin real",
  document: {
    name: "Goblin real",
    texture: { src: "tokens/goblin.webp" },
    getFlag: () => ({
      enabled: true,
      viewers: {
        playerB: {
          enabled: true,
          image: "tokens/human.webp",
          name: "Aldeano",
          scale: 1.5,
          opacity: 0.8,
          hidden: false
        }
      }
    })
  }
};

globalThis.game = {
  i18n: { localize: () => "" },
  settings: { get: () => true, register: () => undefined },
  keybindings: {
    register: (_moduleId, _action, config) => { registeredKeybinding = config; }
  },
  user: { id: "gm", isGM: true },
  users: {
    contents: [
      { id: "gm", name: "GM", isGM: true, active: true },
      { id: "playerA", name: "Ana", isGM: false, active: true },
      { id: "playerB", name: "Bruno", isGM: false, active: false }
    ]
  }
};
globalThis.canvas = {
  tokens: { placeables: [token], controlled: [token] }
};
globalThis.foundry = {
  appv1: { api: { Dialog: DialogMock } }
};
globalThis.ui = { notifications: { warn: () => undefined } };

await import("../scripts/main.js");
registered.get("once:init")();
registered.get("once:ready")();
globalThis.Espejismo.openPanel(token);

const controls = { tokens: { name: "tokens", order: 10, tools: {} } };
registered.get("on:getSceneControlButtons")(controls);

assert.match(dialogContent, /Ve el original/);
assert.match(dialogContent, /Ve otra apariencia/);
assert.match(dialogContent, /No ve el token/);
assert.match(dialogContent, /RESULTADO PARA Ana/);
assert.match(dialogContent, /RESULTADO PARA Bruno/);
assert.match(dialogContent, /Aldeano/);
assert.match(dialogContent, /1.5×/);
assert.match(dialogContent, /80%/);
assert.equal(typeof controls.tokens.tools.espejismo.onChange, "function");
assert.equal(controls.espejismo.icon, "fa-solid fa-eye");
assert.equal(typeof controls.espejismo.onChange, "function");
assert.equal(registeredKeybinding.editable[0].key, "KeyE");

console.log("Espejismo intuitive panel test: OK");
