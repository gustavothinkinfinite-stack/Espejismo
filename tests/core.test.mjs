import assert from "node:assert/strict";
import {
  configFromRows,
  countAssigned,
  normalizeEntry,
  resolvePerception
} from "../scripts/core.js";

const normalized = normalizeEntry({
  enabled: 1,
  image: "  goblin.webp  ",
  name: "  Aldeano  ",
  scale: 99,
  opacity: -2,
  hidden: 0
});

assert.deepEqual(normalized, {
  enabled: true,
  image: "goblin.webp",
  name: "Aldeano",
  scale: 3,
  opacity: 0,
  hidden: false
});

const config = configFromRows([
  { userId: "a", enabled: true, image: "human.webp", name: "Humano", scale: 1, opacity: 1 },
  { userId: "b", enabled: false, image: "", name: "", scale: 1, opacity: 1 }
]);

assert.equal(countAssigned(config), 1);
assert.equal(resolvePerception(config, "a", true).name, "Humano");
assert.equal(resolvePerception(config, "b", true), null);
assert.equal(resolvePerception(config, "a", false), null);
assert.equal(resolvePerception({ ...config, enabled: false }, "a", true), null);

console.log("Perception Tokens core tests: OK");
