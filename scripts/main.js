import {
  MODULE_ID,
  FLAG_KEY,
  configFromRows,
  countAssigned,
  hasAssignments,
  normalizeConfig,
  resolvePerception
} from "./core.js";

const runtime = new WeakMap();
const textureCache = new Map();
let panel = null;
let selectedTokenId = null;

const localize = (key, fallback) => game.i18n?.localize(key) || fallback;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getTokenConfig(token) {
  return normalizeConfig(token?.document?.getFlag(MODULE_ID, FLAG_KEY) ?? {});
}

function getActiveTokens() {
  return canvas?.tokens?.placeables ?? [];
}

function tokenIsConfigured(token) {
  return getTokenConfig(token).enabled && hasAssignments(getTokenConfig(token));
}

function moduleEnabled() {
  return game.settings.get(MODULE_ID, "enabled");
}

function getTextureLoader() {
  return foundry?.canvas?.loadTexture ?? globalThis.loadTexture;
}

async function loadPerceivedTexture(src) {
  const loader = getTextureLoader();
  if (!loader || !src) return null;
  if (!textureCache.has(src)) {
    textureCache.set(src, Promise.resolve(loader(src, {
      fallback: "icons/svg/mystery-man.svg"
    })).then(loaded => loaded?.texture ?? loaded ?? null));
  }
  return textureCache.get(src);
}

function ensureRuntime(token) {
  if (!runtime.has(token)) {
    runtime.set(token, {
      generation: 0,
      perceived: false,
      image: ""
    });
  }
  return runtime.get(token);
}

function resizeTokenMesh(token, scaleX = 1, scaleY = 1) {
  if (!token?.mesh) return;

  if (typeof token.mesh.resize === "function") {
    token.mesh.resize(token.w, token.h, {
      fit: "contain",
      scaleX,
      scaleY
    });
    return;
  }

  // Respaldo defensivo para implementaciones antiguas o meshes personalizados.
  if (token.mesh.scale?.set && token.mesh.texture?.width && token.mesh.texture?.height) {
    const fit = Math.min(
      token.w / token.mesh.texture.width,
      token.h / token.mesh.texture.height
    );
    token.mesh.scale.set(fit * scaleX, fit * scaleY);
  }
}

function restoreToken(token) {
  if (!token) return;
  const state = ensureRuntime(token);
  state.generation += 1;
  state.perceived = false;
  state.image = "";

  if (token.mesh) {
    if (token.texture) token.mesh.texture = token.texture;
    token.mesh.alpha = Number(token.document?.alpha ?? 1);
    token.mesh.visible = true;
    if (typeof token._refreshMeshSizeAndScale === "function") {
      token._refreshMeshSizeAndScale();
    } else {
      resizeTokenMesh(
        token,
        Number(token.document?.texture?.scaleX ?? 1),
        Number(token.document?.texture?.scaleY ?? 1)
      );
    }
  }

  if (token.nameplate) token.nameplate.text = token.document?.name ?? "";
  token.visible = token.isVisible;
}

async function applyPerception(token) {
  if (!token?.document || !token.mesh) return;

  const state = ensureRuntime(token);
  const generation = ++state.generation;
  const entry = resolvePerception(
    token.document.getFlag(MODULE_ID, FLAG_KEY),
    game.user?.id,
    moduleEnabled()
  );

  if (!entry) {
    restoreToken(token);
    return;
  }

  state.perceived = true;

  if (entry.hidden) {
    token.visible = false;
    return;
  }

  token.visible = token.isVisible;
  token.mesh.visible = true;
  token.mesh.alpha = entry.opacity;

  if (entry.name && token.nameplate) token.nameplate.text = entry.name;
  else if (token.nameplate) token.nameplate.text = token.document.name;

  let texture = null;
  if (entry.image) {
    try {
      texture = await loadPerceivedTexture(entry.image);
    } catch (error) {
      console.warn(`${MODULE_ID} | No se pudo cargar la textura percibida`, error);
    }
  }

  if (generation !== state.generation) return;

  if (texture) {
    token.mesh.texture = texture;
    state.image = entry.image;
  } else if (token.texture) {
    token.mesh.texture = token.texture;
    state.image = "";
  }

  const baseScaleX = Number(token.document.texture?.scaleX ?? 1);
  const baseScaleY = Number(token.document.texture?.scaleY ?? 1);
  resizeTokenMesh(
    token,
    baseScaleX * entry.scale,
    baseScaleY * entry.scale
  );
}

async function applyAll() {
  await Promise.allSettled(getActiveTokens().map(applyPerception));
  refreshPanel();
}

function configuredTokenCount() {
  return getActiveTokens().filter(tokenIsConfigured).length;
}

function chooseInitialToken() {
  const tokens = getActiveTokens();
  const controlled = canvas?.tokens?.controlled?.[0];
  if (controlled) return controlled.id;
  if (selectedTokenId && tokens.some(token => token.id === selectedTokenId)) return selectedTokenId;
  return tokens[0]?.id ?? null;
}

function getSelectedToken() {
  return getActiveTokens().find(token => token.id === selectedTokenId) ?? null;
}

function buildPlayerRow(user, entry) {
  const checked = entry.enabled ? "checked" : "";
  const hidden = entry.hidden ? "checked" : "";
  const activeClass = entry.enabled ? "is-active" : "";
  const image = escapeHtml(entry.image);
  const perceivedName = escapeHtml(entry.name);
  const status = user.active ? "is-online" : "is-offline";
  const statusTitle = user.active
    ? localize("PERCEPTION_TOKENS.Online", "Conectado")
    : localize("PERCEPTION_TOKENS.Offline", "Desconectado");

  return `
    <article class="pt-player-row ${activeClass}" data-user-id="${user.id}">
      <header class="pt-player-header">
        <label class="pt-switch">
          <input type="checkbox" data-field="enabled" ${checked}>
          <span class="pt-switch-slider"></span>
        </label>
        <span class="pt-user-status ${status}" title="${statusTitle}"></span>
        <strong>${escapeHtml(user.name)}</strong>
        <span class="pt-row-state">${entry.enabled ? localize("PERCEPTION_TOKENS.Active", "ACTIVO") : localize("PERCEPTION_TOKENS.Inactive", "INACTIVO")}</span>
      </header>
      <div class="pt-player-fields">
        <div class="pt-preview">
          ${image ? `<img src="${image}" alt="">` : '<i class="fa-solid fa-user-secret"></i>'}
        </div>
        <label class="pt-field pt-field-image">
          <span>${localize("PERCEPTION_TOKENS.Image", "Imagen aparente")}</span>
          <div class="pt-file-row">
            <input type="text" data-field="image" value="${image}" placeholder="tokens/apariencia.webp">
            <button type="button" class="pt-file-picker" title="${localize("PERCEPTION_TOKENS.Browse", "Buscar archivo")}">
              <i class="fa-solid fa-folder-open"></i>
            </button>
          </div>
        </label>
        <label class="pt-field">
          <span>${localize("PERCEPTION_TOKENS.Name", "Nombre aparente")}</span>
          <input type="text" data-field="name" value="${perceivedName}" placeholder="${localize("PERCEPTION_TOKENS.RealName", "Dejar vacío para el nombre real")}">
        </label>
        <label class="pt-field pt-field-small">
          <span>${localize("PERCEPTION_TOKENS.Scale", "Escala")}</span>
          <input type="number" data-field="scale" value="${entry.scale}" min="0.25" max="3" step="0.05">
        </label>
        <label class="pt-field pt-field-small">
          <span>${localize("PERCEPTION_TOKENS.Opacity", "Opacidad")}</span>
          <input type="number" data-field="opacity" value="${Math.round(entry.opacity * 100)}" min="0" max="100" step="5">
        </label>
        <label class="pt-hidden-check">
          <input type="checkbox" data-field="hidden" ${hidden}>
          <i class="fa-solid fa-eye-slash"></i>
          ${localize("PERCEPTION_TOKENS.Hide", "Ocultar para este jugador")}
        </label>
      </div>
    </article>`;
}

function buildPanelContent() {
  const tokens = getActiveTokens();
  const token = getSelectedToken();
  const enabled = moduleEnabled();
  const config = token ? getTokenConfig(token) : normalizeConfig();
  const players = game.users?.contents?.filter(user => !user.isGM) ?? [];
  const tokenOptions = tokens.map(item => {
    const configured = tokenIsConfigured(item) ? " • 👁" : "";
    return `<option value="${item.id}" ${item.id === selectedTokenId ? "selected" : ""}>${escapeHtml(item.name)}${configured}</option>`;
  }).join("");

  const assigned = token ? countAssigned(config) : 0;
  const playerRows = players.length
    ? players.map(user => buildPlayerRow(user, config.viewers[user.id] ?? {
        enabled: false,
        image: "",
        name: "",
        scale: 1,
        opacity: 1,
        hidden: false
      })).join("")
    : `<p class="pt-empty">${localize("PERCEPTION_TOKENS.NoPlayers", "No hay jugadores creados en este mundo.")}</p>`;

  return `
    <form class="pt-panel-form" autocomplete="off">
      <section class="pt-summary">
        <div class="pt-status-card ${enabled ? "is-enabled" : "is-disabled"}">
          <i class="fa-solid ${enabled ? "fa-eye" : "fa-eye-slash"}"></i>
          <div>
            <small>${localize("PERCEPTION_TOKENS.ModuleStatus", "ESTADO DEL MÓDULO")}</small>
            <strong>${enabled ? localize("PERCEPTION_TOKENS.Enabled", "ACTIVO") : localize("PERCEPTION_TOKENS.Paused", "PAUSADO")}</strong>
          </div>
          <button type="button" data-action="toggle-module" class="pt-toggle-module">
            ${enabled ? localize("PERCEPTION_TOKENS.Pause", "Pausar") : localize("PERCEPTION_TOKENS.Enable", "Activar")}
          </button>
        </div>
        <div class="pt-metric">
          <span>${configuredTokenCount()}</span>
          <small>${localize("PERCEPTION_TOKENS.ConfiguredTokens", "tokens configurados")}</small>
        </div>
        <div class="pt-metric">
          <span>${assigned}</span>
          <small>${localize("PERCEPTION_TOKENS.AssignedPlayers", "jugadores en este token")}</small>
        </div>
      </section>

      <section class="pt-token-selector">
        <label>
          <span>${localize("PERCEPTION_TOKENS.SelectedToken", "Token seleccionado")}</span>
          <select data-action="select-token" ${tokens.length ? "" : "disabled"}>
            ${tokenOptions || `<option>${localize("PERCEPTION_TOKENS.NoTokens", "No hay tokens en la escena")}</option>`}
          </select>
        </label>
        <label class="pt-token-enabled ${config.enabled ? "is-active" : ""}">
          <input type="checkbox" data-action="token-enabled" ${config.enabled ? "checked" : ""} ${token ? "" : "disabled"}>
          <span>${localize("PERCEPTION_TOKENS.TokenEnabled", "Percepciones habilitadas en este token")}</span>
        </label>
        <button type="button" data-action="use-controlled" ${canvas?.tokens?.controlled?.length ? "" : "disabled"}>
          <i class="fa-solid fa-crosshairs"></i> ${localize("PERCEPTION_TOKENS.UseControlled", "Usar token controlado")}
        </button>
      </section>

      <section class="pt-help">
        <i class="fa-solid fa-circle-info"></i>
        <span>${localize("PERCEPTION_TOKENS.Help", "Cada jugador verá únicamente su apariencia asignada. El token real, sus estadísticas y sus tiradas no se modifican.")}</span>
      </section>

      <section class="pt-player-list ${token ? "" : "is-disabled"}">
        ${playerRows}
      </section>

      <footer class="pt-actions">
        <button type="button" data-action="clear-token" class="pt-danger" ${token ? "" : "disabled"}>
          <i class="fa-solid fa-trash"></i> ${localize("PERCEPTION_TOKENS.Clear", "Limpiar este token")}
        </button>
        <button type="button" data-action="save" class="pt-primary" ${token ? "" : "disabled"}>
          <i class="fa-solid fa-floppy-disk"></i> ${localize("PERCEPTION_TOKENS.Save", "Guardar y aplicar")}
        </button>
      </footer>
    </form>`;
}

function getRoot(html) {
  return html?.[0] ?? html;
}

function refreshPanel() {
  if (!panel?.rendered) return;
  panel.data.content = buildPanelContent();
  panel.render(true);
}

function collectRows(root) {
  return [...root.querySelectorAll(".pt-player-row")].map(row => ({
    userId: row.dataset.userId,
    enabled: row.querySelector('[data-field="enabled"]')?.checked,
    image: row.querySelector('[data-field="image"]')?.value ?? "",
    name: row.querySelector('[data-field="name"]')?.value ?? "",
    scale: row.querySelector('[data-field="scale"]')?.value ?? 1,
    opacity: Number(row.querySelector('[data-field="opacity"]')?.value ?? 100) / 100,
    hidden: row.querySelector('[data-field="hidden"]')?.checked
  }));
}

function openFilePicker(input, preview) {
  const callback = path => {
    input.value = path;
    if (preview) preview.innerHTML = `<img src="${escapeHtml(path)}" alt="">`;
  };

  const LegacyFilePicker = foundry?.appv1?.api?.FilePicker ?? globalThis.FilePicker;
  if (LegacyFilePicker) {
    new LegacyFilePicker({
      type: "imagevideo",
      current: input.value,
      callback
    }).render(true);
    return;
  }

  const ModernFilePicker = foundry?.applications?.apps?.FilePicker?.implementation;
  if (ModernFilePicker) {
    new ModernFilePicker({ type: "imagevideo", current: input.value, callback }).render({ force: true });
  }
}

function bindPanelListeners(dialog, html) {
  const root = getRoot(html);
  if (!root) return;

  root.querySelector('[data-action="toggle-module"]')?.addEventListener("click", async () => {
    await game.settings.set(MODULE_ID, "enabled", !moduleEnabled());
    await applyAll();
  });

  root.querySelector('[data-action="select-token"]')?.addEventListener("change", event => {
    selectedTokenId = event.currentTarget.value;
    refreshPanel();
  });

  root.querySelector('[data-action="use-controlled"]')?.addEventListener("click", () => {
    const controlled = canvas?.tokens?.controlled?.[0];
    if (!controlled) return;
    selectedTokenId = controlled.id;
    refreshPanel();
  });

  root.querySelectorAll('[data-field="enabled"]').forEach(input => {
    input.addEventListener("change", () => {
      const row = input.closest(".pt-player-row");
      row.classList.toggle("is-active", input.checked);
      const state = row.querySelector(".pt-row-state");
      if (state) state.textContent = input.checked
        ? localize("PERCEPTION_TOKENS.Active", "ACTIVO")
        : localize("PERCEPTION_TOKENS.Inactive", "INACTIVO");
    });
  });

  root.querySelectorAll(".pt-file-picker").forEach(button => {
    button.addEventListener("click", () => {
      const row = button.closest(".pt-player-row");
      openFilePicker(row.querySelector('[data-field="image"]'), row.querySelector(".pt-preview"));
    });
  });

  root.querySelector('[data-action="save"]')?.addEventListener("click", async () => {
    const token = getSelectedToken();
    if (!token) return;
    const tokenEnabled = root.querySelector('[data-action="token-enabled"]')?.checked ?? true;
    const config = configFromRows(collectRows(root), tokenEnabled);
    await token.document.setFlag(MODULE_ID, FLAG_KEY, config);
    await applyAll();
    ui.notifications.info(localize("PERCEPTION_TOKENS.Saved", "Percepciones guardadas y aplicadas."));
  });

  root.querySelector('[data-action="clear-token"]')?.addEventListener("click", async () => {
    const token = getSelectedToken();
    if (!token) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: localize("PERCEPTION_TOKENS.ClearTitle", "Limpiar percepciones") },
      content: `<p>${localize("PERCEPTION_TOKENS.ClearConfirm", "¿Querés eliminar todas las apariencias asignadas a este token?")}</p>`,
      rejectClose: false,
      modal: true
    });
    if (!confirmed) return;
    await token.document.unsetFlag(MODULE_ID, FLAG_KEY);
    await applyAll();
    ui.notifications.info(localize("PERCEPTION_TOKENS.Cleared", "Se limpiaron las percepciones del token."));
  });
}

function openPanel(token = null) {
  if (!game.user?.isGM) {
    ui.notifications.warn(localize("PERCEPTION_TOKENS.GMOnly", "Solo el GM puede administrar las percepciones."));
    return;
  }

  if (token) selectedTokenId = token.id;
  selectedTokenId = selectedTokenId ?? chooseInitialToken();

  if (panel?.rendered) {
    panel.data.content = buildPanelContent();
    panel.render(true);
    panel.bringToTop?.();
    return;
  }

  const DialogClass = foundry.appv1.api.Dialog;
  panel = new DialogClass({
    title: localize("PERCEPTION_TOKENS.PanelTitle", "Perception Tokens — Panel del GM"),
    content: buildPanelContent(),
    buttons: {
      close: {
        icon: '<i class="fa-solid fa-xmark"></i>',
        label: localize("PERCEPTION_TOKENS.Close", "Cerrar")
      }
    },
    render: html => bindPanelListeners(panel, html),
    close: () => { panel = null; }
  }, {
    id: "perception-tokens-panel",
    width: 920,
    height: "auto",
    resizable: true,
    classes: ["perception-tokens-window"]
  });
  panel.render(true);
}

function addSceneControl(controls) {
  if (!game.user?.isGM) return;

  if (Array.isArray(controls)) {
    const tokenControls = controls.find(control => control.name === "token");
    tokenControls?.tools?.push({
      name: MODULE_ID,
      title: localize("PERCEPTION_TOKENS.OpenPanel", "Administrar percepciones"),
      icon: "fa-solid fa-eye",
      button: true,
      onClick: () => openPanel()
    });
    return;
  }

  if (!controls?.tokens?.tools) return;
  controls.tokens.tools[MODULE_ID] = {
    name: MODULE_ID,
    title: "PERCEPTION_TOKENS.OpenPanel",
    icon: "fa-solid fa-eye",
    order: Object.keys(controls.tokens.tools).length,
    button: true,
    visible: true,
    onChange: () => openPanel()
  };
}

function addTokenHudButton(app, html, tokenData) {
  if (!game.user?.isGM) return;
  const root = getRoot(html);
  const token = app?.object ?? canvas?.tokens?.get(tokenData?._id ?? tokenData?.id);
  if (!root || !token || root.querySelector(".pt-hud-button")) return;

  const column = root.querySelector(".col.right") ?? root.querySelector(".right");
  if (!column) return;
  const button = document.createElement("div");
  button.className = `control-icon pt-hud-button ${tokenIsConfigured(token) ? "active" : ""}`;
  button.dataset.tooltip = localize("PERCEPTION_TOKENS.OpenForToken", "Configurar percepción por jugador");
  button.innerHTML = '<i class="fa-solid fa-eye"></i>';
  button.addEventListener("click", event => {
    event.preventDefault();
    openPanel(token);
  });
  column.append(button);
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "enabled", {
    name: "PERCEPTION_TOKENS.SettingEnabledName",
    hint: "PERCEPTION_TOKENS.SettingEnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    restricted: true,
    onChange: () => applyAll()
  });
});

Hooks.once("ready", () => {
  globalThis.Espejismo = {
    openPanel,
    applyAll,
    applyToToken: applyPerception,
    getConfig: token => getTokenConfig(token)
  };
  globalThis.PerceptionTokens = globalThis.Espejismo;
  applyAll();
});

Hooks.on("getSceneControlButtons", addSceneControl);
Hooks.on("canvasReady", applyAll);
Hooks.on("drawObject", object => {
  if (object?.document?.documentName === "Token") applyPerception(object);
});
Hooks.on("refreshObject", object => {
  if (object?.document?.documentName === "Token") applyPerception(object);
});
Hooks.on("drawToken", applyPerception);
Hooks.on("refreshToken", applyPerception);
Hooks.on("visibilityRefresh", () => {
  Promise.allSettled(getActiveTokens().map(applyPerception));
});
Hooks.on("updateToken", tokenDocument => {
  if (tokenDocument?.object) applyPerception(tokenDocument.object);
  refreshPanel();
});
Hooks.on("deleteToken", () => refreshPanel());
Hooks.on("createToken", () => refreshPanel());
Hooks.on("renderTokenHUD", addTokenHudButton);

console.log(`${MODULE_ID} | Módulo cargado`);
