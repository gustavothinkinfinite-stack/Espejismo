export const MODULE_ID = "espejismo";
export const FLAG_KEY = "config";

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export function normalizeEntry(raw = {}) {
  return {
    enabled: Boolean(raw.enabled),
    image: typeof raw.image === "string" ? raw.image.trim() : "",
    name: typeof raw.name === "string" ? raw.name.trim() : "",
    scale: clamp(raw.scale, 0.25, 3, 1),
    opacity: clamp(raw.opacity, 0, 1, 1),
    hidden: Boolean(raw.hidden)
  };
}

export function normalizeConfig(raw = {}) {
  const viewers = {};
  for (const [userId, entry] of Object.entries(raw?.viewers ?? {})) {
    viewers[userId] = normalizeEntry(entry);
  }

  return {
    enabled: raw?.enabled !== false,
    viewers
  };
}

export function resolvePerception(rawConfig, userId, moduleEnabled = true) {
  if (!moduleEnabled || !userId) return null;
  const config = normalizeConfig(rawConfig);
  if (!config.enabled) return null;
  const entry = config.viewers[userId];
  if (!entry?.enabled) return null;
  return entry;
}

export function countAssigned(rawConfig) {
  const config = normalizeConfig(rawConfig);
  return Object.values(config.viewers).filter(entry => entry.enabled).length;
}

export function hasAssignments(rawConfig) {
  return countAssigned(rawConfig) > 0;
}

export function configFromRows(rows, tokenEnabled = true) {
  const viewers = {};
  for (const row of rows) {
    if (!row?.userId) continue;
    viewers[row.userId] = normalizeEntry(row);
  }
  return normalizeConfig({ enabled: tokenEnabled, viewers });
}
