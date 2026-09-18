import {
  MODULE_ID,
  FLAG_KEY,
  configFromRows,
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

function getTokenImage(token) {
  return token?.document?.texture?.src ?? token?.document?.img ?? "";
}

function buildPlayerRow(user, entry, token) {
  const mode = entry.enabled ? (entry.hidden ? "hidden" : "custom") : "original";
  const image = escapeHtml(entry.image);
  const perceivedName = escapeHtml(entry.name);
  const realName = escapeHtml(token?.document?.name ?? token?.name ?? "Token");
  const originalImage = escapeHtml(getTokenImage(token));
  const effectiveImage = image || originalImage;
  const effectiveName = perceivedName || realName;
  const status = user.active ? "is-online" : "is-offline";
  const statusTitle = user.active
    ? localize("PERCEPTION_TOKENS.Online", "Conectado")
    : localize("PERCEPTION_TOKENS.Offline", "Desconectado");
  const resultName = mode === "hidden"
    ? localize("PERCEPTION_TOKENS.NotVisible", "Token oculto")
    : effectiveName;
  const resultCaption = mode === "original"
    ? localize("PERCEPTION_TOKENS.ResultOriginal", "Verá la imagen y el nombre originales.")
    : mode === "hidden"
      ? localize("PERCEPTION_TOKENS.ResultHidden", "No verá este token en el mapa.")
      : localize("PERCEPTION_TOKENS.ResultCustom", "Verá esta apariencia en lugar del token original.");

  return `
    <article class="pt-player-row is-${mode}" data-user-id="${user.id}" data-real-name="${realName}" data-original-image="${originalImage}">
      <header class="pt-player-header">
        <span class="pt-user-status ${status}" title="${statusTitle}"></span>
        <div>
          <small>${localize("PERCEPTION_TOKENS.WhatSees", "¿QUÉ VERÁ?")}</small>
          <strong>${escapeHtml(user.name)}</strong>
        </div>
        <span class="pt-row-state"></span>
      </header>

      <div class="pt-mode-picker" role="radiogroup" aria-label="${localize("PERCEPTION_TOKENS.ViewMode", "Vista del jugador")}">
        <label>
          <input type="radio" data-field="mode" name="pt-mode-${escapeHtml(user.id)}" value="original" ${mode === "original" ? "checked" : ""}>
          <span><i class="fa-solid fa-rotate-left"></i>${localize("PERCEPTION_TOKENS.SeesOriginal", "Ve el original")}</span>
        </label>
        <label>
          <input type="radio" data-field="mode" name="pt-mode-${escapeHtml(user.id)}" value="custom" ${mode === "custom" ? "checked" : ""}>
          <span><i class="fa-solid fa-wand-magic-sparkles"></i>${localize("PERCEPTION_TOKENS.SeesCustom", "Ve otra apariencia")}</span>
        </label>
        <label>
          <input type="radio" data-field="mode" name="pt-mode-${escapeHtml(user.id)}" value="hidden" ${mode === "hidden" ? "checked" : ""}>
          <span><i class="fa-solid fa-eye-slash"></i>${localize("PERCEPTION_TOKENS.SeesNothing", "No ve el token")}</span>
        </label>
      </div>

      <div class="pt-player-body">
        <section class="pt-result-card">
          <div class="pt-result-label">${localize("PERCEPTION_TOKENS.ResultFor", "RESULTADO PARA")} ${escapeHtml(user.name)}</div>
          <div class="pt-result-visual ${mode === "hidden" ? "is-hidden" : ""}">
            ${mode !== "hidden" && effectiveImage ? `<img src="${effectiveImage}" alt="">` : `<i class="fa-solid ${mode === "hidden" ? "fa-eye-slash" : "fa-user-secret"}"></i>`}
          </div>
          <div class="pt-result-copy">
            <strong>${resultName}</strong>
            <span>${resultCaption}</span>
            <div class="pt-result-badges ${mode === "custom" ? "" : "is-concealed"}">
              <span data-result="scale">${entry.scale}×</span>
              <span data-result="opacity">${Math.round(entry.opacity * 100)}%</span>
            </div>
          </div>
        </section>

        <section class="pt-custom-editor">
          <div class="pt-editor-title">
            <i class="fa-solid fa-sliders"></i>
            <span>${localize("PERCEPTION_TOKENS.CustomizeAppearance", "Personalizar lo que verá")}</span>
          </div>
          <div class="pt-player-fields">
            <label class="pt-field pt-field-image">
              <span>${localize("PERCEPTION_TOKENS.Image", "Imagen aparente")}</span>
              <div class="pt-file-row">
                <input type="text" data-field="image" value="${image}" placeholder="${originalImage || "tokens/apariencia.webp"}">
                <button type="button" class="pt-file-picker" title="${localize("PERCEPTION_TOKENS.Browse", "Buscar archivo")}">
                  <i class="fa-solid fa-folder-open"></i>
                </button>
              </div>
              <small>${localize("PERCEPTION_TOKENS.ImageHint", "Vacío = usa la imagen original")}</small>
            </label>
            <label class="pt-field">
              <span>${localize("PERCEPTION_TOKENS.Name", "Nombre aparente")}</span>
              <input type="text" data-field="name" value="${perceivedName}" placeholder="${realName}">
              <small>${localize("PERCEPTION_TOKENS.NameHint", "Vacío = usa el nombre original")}</small>
            </label>
            <label class="pt-field pt-field-small">
              <span>${localize("PERCEPTION_TOKENS.Scale", "Tamaño")}</span>
              <div class="pt-input-suffix">
                <input type="number" data-field="scale" value="${entry.scale}" min="0.25" max="3" step="0.05">
                <span>×</span>
              </div>
            </label>
            <label class="pt-field pt-field-small">
              <span>${localize("PERCEPTION_TOKENS.Opacity", "Opacidad")}</span>
              <div class="pt-input-suffix">
                <input type="number" data-field="opacity" value="${Math.round(entry.opacity * 100)}" min="0" max="100" step="5">
                <span>%</span>
              </div>
            </label>
          </div>
        </section>
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

  const playerRows = players.length
    ? players.map(user => buildPlayerRow(user, config.viewers[user.id] ?? {
        enabled: false,
        image: "",
        name: "",
        scale: 1,
        opacity: 1,
        hidden: false
      }, token)).join("")
    : `<p class="pt-empty">${localize("PERCEPTION_TOKENS.NoPlayers", "No hay jugadores creados en este mundo.")}</p>`;

  return `
    <form class="pt-panel-form" autocomplete="off">
      <section class="pt-world-status ${enabled ? "is-enabled" : "is-disabled"}">
        <div class="pt-status-card ${enabled ? "is-enabled" : "is-disabled"}">
          <i class="fa-solid ${enabled ? "fa-eye" : "fa-eye-slash"}"></i>
          <div>
            <small>${localize("PERCEPTION_TOKENS.ModuleStatus", "ESTADO DEL MÓDULO")}</small>
            <strong>${enabled ? localize("PERCEPTION_TOKENS.WorldActive", "Espejismo está activo") : localize("PERCEPTION_TOKENS.WorldPaused", "Espejismo está pausado")}</strong>
            <span>${enabled ? localize("PERCEPTION_TOKENS.WorldActiveHint", "Cada jugador ve las reglas guardadas para él.") : localize("PERCEPTION_TOKENS.WorldPausedHint", "Todos ven los tokens originales; las reglas siguen guardadas.")}</span>
          </div>
          <button type="button" data-action="toggle-module" class="pt-toggle-module">
            ${enabled ? localize("PERCEPTION_TOKENS.Pause", "Pausar") : localize("PERCEPTION_TOKENS.Enable", "Activar")}
          </button>
        </div>
        <div class="pt-world-metric"><strong>${configuredTokenCount()}</strong><span>${localize("PERCEPTION_TOKENS.ConfiguredTokens", "tokens configurados")}</span></div>
      </section>

      <section class="pt-step pt-token-step">
        <div class="pt-step-number">1</div>
        <div class="pt-step-content">
          <h3>${localize("PERCEPTION_TOKENS.StepToken", "Elegí el token que querés configurar")}</h3>
          <div class="pt-token-selector">
            <label>
              <span>${localize("PERCEPTION_TOKENS.SelectedToken", "Token seleccionado")}</span>
              <select data-action="select-token" ${tokens.length ? "" : "disabled"}>
                ${tokenOptions || `<option>${localize("PERCEPTION_TOKENS.NoTokens", "No hay tokens en la escena")}</option>`}
              </select>
            </label>
            <button type="button" data-action="use-controlled" ${canvas?.tokens?.controlled?.length ? "" : "disabled"}>
              <i class="fa-solid fa-crosshairs"></i> ${localize("PERCEPTION_TOKENS.UseControlled", "Usar token seleccionado en el mapa")}
            </button>
          </div>
          <label class="pt-token-gate ${config.enabled ? "is-active" : "is-paused"}">
            <input type="checkbox" data-action="token-enabled" ${config.enabled ? "checked" : ""} ${token ? "" : "disabled"}>
            <span class="pt-switch-slider"></span>
            <span class="pt-token-gate-copy">
              <strong>${localize("PERCEPTION_TOKENS.TokenRules", "Aplicar reglas especiales a este token")}</strong>
              <small>${config.enabled ? localize("PERCEPTION_TOKENS.TokenRulesOn", "Las elecciones de cada jugador se aplicarán al guardar.") : localize("PERCEPTION_TOKENS.TokenRulesOff", "Está apagado: todos verán el token original.")}</small>
            </span>
          </label>
        </div>
      </section>

      <section class="pt-step pt-viewers-step">
        <div class="pt-step-number">2</div>
        <div class="pt-step-content">
          <h3>${localize("PERCEPTION_TOKENS.StepPlayers", "Decidí qué verá cada jugador")}</h3>
          <p>${localize("PERCEPTION_TOKENS.StepPlayersHint", "El resultado se muestra dentro de cada tarjeta. Los jugadores sin cambios verán el token original.")}</p>
        </div>
      </section>

      <section class="pt-player-list ${token ? "" : "is-disabled"}">
        ${playerRows}
      </section>

      <footer class="pt-actions">
        <button type="button" data-action="clear-token" class="pt-danger" ${token ? "" : "disabled"}>
          <i class="fa-solid fa-trash"></i> ${localize("PERCEPTION_TOKENS.Clear", "Limpiar este token")}
        </button>
        <div class="pt-save-area">
          <span class="pt-unsaved"><i class="fa-solid fa-circle"></i> ${localize("PERCEPTION_TOKENS.Unsaved", "Hay cambios sin guardar")}</span>
          <button type="button" data-action="save" class="pt-primary" ${token ? "" : "disabled"}>
            <i class="fa-solid fa-floppy-disk"></i> ${localize("PERCEPTION_TOKENS.Save", "Guardar y aplicar")}
          </button>
        </div>
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
  return [...root.querySelectorAll(".pt-player-row")].map(row => {
    const mode = row.querySelector('[data-field="mode"]:checked')?.value ?? "original";
    return {
      userId: row.dataset.userId,
      enabled: mode !== "original",
      image: row.querySelector('[data-field="image"]')?.value ?? "",
      name: row.querySelector('[data-field="name"]')?.value ?? "",
      scale: row.querySelector('[data-field="scale"]')?.value ?? 1,
      opacity: Number(row.querySelector('[data-field="opacity"]')?.value ?? 100) / 100,
      hidden: mode === "hidden"
    };
  });
}

function markPanelDirty(root) {
  root.querySelector(".pt-unsaved")?.classList.add("is-visible");
}

function updatePlayerResult(row) {
  const mode = row.querySelector('[data-field="mode"]:checked')?.value ?? "original";
  const realName = row.dataset.realName || "Token";
  const originalImage = row.dataset.originalImage || "";
  const customImage = row.querySelector('[data-field="image"]')?.value.trim() ?? "";
  const customName = row.querySelector('[data-field="name"]')?.value.trim() ?? "";
  const scale = row.querySelector('[data-field="scale"]')?.value || "1";
  const opacity = row.querySelector('[data-field="opacity"]')?.value || "100";
  const visual = row.querySelector(".pt-result-visual");
  const name = row.querySelector(".pt-result-copy > strong");
  const caption = row.querySelector(".pt-result-copy > span");
  const badges = row.querySelector(".pt-result-badges");
  const state = row.querySelector(".pt-row-state");

  row.classList.remove("is-original", "is-custom", "is-hidden");
  row.classList.add(`is-${mode}`);

  if (state) {
    state.textContent = mode === "custom"
      ? localize("PERCEPTION_TOKENS.StateCustom", "OTRA APARIENCIA")
      : mode === "hidden"
        ? localize("PERCEPTION_TOKENS.StateHidden", "OCULTO")
        : localize("PERCEPTION_TOKENS.StateOriginal", "ORIGINAL");
  }

  const effectiveImage = mode === "custom" ? (customImage || originalImage) : originalImage;
  if (visual) {
    visual.classList.toggle("is-hidden", mode === "hidden");
    visual.innerHTML = mode !== "hidden" && effectiveImage
      ? `<img src="${escapeHtml(effectiveImage)}" alt="">`
      : `<i class="fa-solid ${mode === "hidden" ? "fa-eye-slash" : "fa-user-secret"}"></i>`;
  }

  if (name) name.textContent = mode === "hidden"
    ? localize("PERCEPTION_TOKENS.NotVisible", "Token oculto")
    : mode === "custom" ? (customName || realName) : realName;

  if (caption) caption.textContent = mode === "custom"
    ? localize("PERCEPTION_TOKENS.ResultCustom", "Verá esta apariencia en lugar del token original.")
    : mode === "hidden"
      ? localize("PERCEPTION_TOKENS.ResultHidden", "No verá este token en el mapa.")
      : localize("PERCEPTION_TOKENS.ResultOriginal", "Verá la imagen y el nombre originales.");

  badges?.classList.toggle("is-concealed", mode !== "custom");
  const scaleBadge = row.querySelector('[data-result="scale"]');
  const opacityBadge = row.querySelector('[data-result="opacity"]');
  if (scaleBadge) scaleBadge.textContent = `${scale}×`;
  if (opacityBadge) opacityBadge.textContent = `${opacity}%`;
}

function openFilePicker(input, onChange) {
  const callback = path => {
    input.value = path;
    onChange?.();
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

  root.querySelectorAll(".pt-player-row").forEach(row => {
    updatePlayerResult(row);
    row.querySelectorAll('[data-field="mode"]').forEach(input => {
      input.addEventListener("change", () => {
        updatePlayerResult(row);
        markPanelDirty(root);
      });
    });
    row.querySelectorAll('[data-field="image"], [data-field="name"], [data-field="scale"], [data-field="opacity"]').forEach(input => {
      input.addEventListener("input", () => {
        updatePlayerResult(row);
        markPanelDirty(root);
      });
    });
  });

  root.querySelectorAll(".pt-file-picker").forEach(button => {
    button.addEventListener("click", () => {
      const row = button.closest(".pt-player-row");
      openFilePicker(row.querySelector('[data-field="image"]'), () => {
        updatePlayerResult(row);
        markPanelDirty(root);
      });
    });
  });

  root.querySelector('[data-action="token-enabled"]')?.addEventListener("change", event => {
    const gate = event.currentTarget.closest(".pt-token-gate");
    const copy = gate?.querySelector("small");
    gate?.classList.toggle("is-active", event.currentTarget.checked);
    gate?.classList.toggle("is-paused", !event.currentTarget.checked);
    if (copy) copy.textContent = event.currentTarget.checked
      ? localize("PERCEPTION_TOKENS.TokenRulesOn", "Las elecciones de cada jugador se aplicarán al guardar.")
      : localize("PERCEPTION_TOKENS.TokenRulesOff", "Está apagado: todos verán el token original.");
    markPanelDirty(root);
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
    width: 880,
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
  const openTool = {
    name: MODULE_ID,
    title: "PERCEPTION_TOKENS.OpenPanel",
    icon: "fa-solid fa-eye",
    order: Object.keys(controls.tokens.tools).length,
    button: true,
    visible: true,
    onChange: () => openPanel()
  };
  controls.tokens.tools[MODULE_ID] = openTool;

  // Acceso principal visible incluso si el usuario ocultó herramientas del grupo Tokens.
  controls[MODULE_ID] = {
    name: MODULE_ID,
    title: "PERCEPTION_TOKENS.OpenPanel",
    icon: "fa-solid fa-eye",
    order: Number(controls.tokens.order ?? 0) + 1,
    visible: true,
    activeTool: "open",
    onChange: (_event, active) => {
      if (active) openPanel();
    },
    tools: {
      open: {
        ...openTool,
        name: "open",
        order: 0
      }
    }
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

  game.keybindings?.register(MODULE_ID, "openPanel", {
    name: "PERCEPTION_TOKENS.KeybindingName",
    hint: "PERCEPTION_TOKENS.KeybindingHint",
    editable: [{ key: "KeyE", modifiers: ["Control", "Shift"] }],
    restricted: true,
    onDown: () => {
      if (!game.user?.isGM) return false;
      openPanel();
      return true;
    }
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
