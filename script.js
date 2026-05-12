(() => {
  "use strict";

  const STORAGE_THEME_KEY = "selectedTheme";
  const STORAGE_LINKS_KEY = "themeLinks";
  const STORAGE_NOTION_MODE_KEY = "notionMode";
  const USER_ID_STORAGE_KEY = "notionThemeUserId";
  const CHANNEL_NAME = "reading-tracker-theme-sync";

  const API_URL = "https://notion-theme-api.notionably.workers.dev/";

  const DEFAULT_THEME = "default";
  const DEFAULT_NOTION_MODE = "dark";
  const POLL_INTERVAL_MS = 500;

  const THEMES = [
    { value: "default", label: "Default" },
    { value: "dark-romance", label: "Dark Romance" },
    { value: "enchanted", label: "Enchanted" },
    { value: "dark-academia", label: "Dark Academia" },
    { value: "fantasy", label: "Fantasy" },
    { value: "spellbound", label: "Spellbound" },
    { value: "cottagecore", label: "Cottagecore" },
    { value: "fairytale", label: "Fairytale" },
    { value: "platform-9-3-4", label: "Platform 9 ¾" },
    { value: "autumn-bookshop", label: "Autumn Bookshop" },
    { value: "wonderland", label: "Wonderland" },
    { value: "white-ethereal", label: "White Ethereal" }
  ];

  const VALID_LINK_KEYS = [
    "settings",
    "home",
    "library",
    "tbrlibrary",
    "readingnowlibrary",
    "serieslibrary",
    "moodreader",
    "readinggoals",
    "readinginsights"
  ];

  const VALID_ASSETS = [
    "homenav.png",
    "librarynav.png",
    "moodnav.png",
    "goalsnav.png",
    "insightsnav.png",
    "libraryimage1.png",
    "libraryimage2.png",
    "homeimage.png",
    "readingchallenges.png",
    "halloffavorites.png",
    "readingera.png",
    "chaptersoftheyear.png",
    "underline.png",
    "moodquote.png",
    "goalquote.png",
    "divider.png",
    "goalprogress.png",
    "yearoverview.png",
    "readinggoals.png",
    "tropes.png",
    "genres.png",
    "bookfinder.png",
    "authors.png",
    "shelfcheck.png",
    "upcomingreleases.png",
    "nowplaying.png",
    "mylibrary.png",
    "streaks.png",
    "readingnowhead.png",
    "insightsimage.png",
    "moodimage.png",
    "goalsimage.png",
    "series.png",
    "seriesselected.png",
    "readingnow.png",
    "readingnowselected.png",
    "toberead.png",
    "tobereadselected.png",
    "allbooks.png",
    "allbooksselected.png",
    "threearches.png"
  ];

  const params = new URLSearchParams(window.location.search);
  const type = params.get("type");
  const assetParam = params.get("asset");
  const linkKeyParam = params.get("linkKey");
  const layoutParam = params.get("layout");
  const navModeParam = params.get("navMode");

  const app = document.getElementById("app");

  let broadcastChannel = null;
  let lastThemeSnapshot = "";
  let lastLinksSnapshot = "";
  let lastNotionModeSnapshot = "";
  let controlEventsBound = false;
  let cloudLoaded = false;

  function canUseLocalStorage() {
    try {
      const testKey = "__theme_widget_test__";
      localStorage.setItem(testKey, "1");
      localStorage.removeItem(testKey);
      return true;
    } catch (error) {
      console.warn("localStorage unavailable:", error);
      return false;
    }
  }

  const storageAvailable = canUseLocalStorage();

  function rawGetItem(key) {
    if (!storageAvailable) return null;

    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.warn(`Could not raw-read ${key}:`, error);
      return null;
    }
  }

  function rawSetItem(key, value) {
    if (!storageAvailable) return;

    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.warn(`Could not raw-save ${key}:`, error);
    }
  }

  function rawRemoveItem(key) {
    if (!storageAvailable) return;

    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn(`Could not raw-remove ${key}:`, error);
    }
  }

  function createUserId() {
    return `rt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function extractNotionPageId(urlValue) {
    const value = decodeURIComponent(String(urlValue || "")).trim();
    const compactValue = value.replace(/-/g, "");
    const pageIdMatch = compactValue.match(/[0-9a-f]{32}/i);

    if (pageIdMatch) {
      return pageIdMatch[0].toLowerCase();
    }

    return value
      .replace(/^https:\/\/www\.notion\.so\//i, "")
      .replace(/^http:\/\/www\.notion\.so\//i, "")
      .replace(/^notion:\/\/www\.notion\.so\//i, "")
      .replace(/[?#].*$/, "")
      .trim()
      .toLowerCase();
  }

  function getCurrentNotionPageId() {
    const candidates = [
      document.referrer,
      window.location.href
    ];

    for (const candidate of candidates) {
      const pageId = extractNotionPageId(candidate);

      if (pageId && /^[0-9a-f]{32}$/i.test(pageId)) {
        return pageId;
      }
    }

    return "";
  }

  function getRawSavedLinks() {
    const raw = rawGetItem(STORAGE_LINKS_KEY);
    if (!raw) return {};

    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      console.warn("Raw saved links were invalid JSON:", error);
      return {};
    }
  }

  function getUserId() {
    const savedUserId = rawGetItem(USER_ID_STORAGE_KEY);

    if (savedUserId) {
      return savedUserId;
    }

    const rawLinks = getRawSavedLinks();
    const primaryLink = rawLinks.home || rawLinks.settings;

    if (primaryLink) {
      const extractedId = extractNotionPageId(primaryLink);
      rawSetItem(USER_ID_STORAGE_KEY, extractedId);
      return extractedId;
    }

    const currentPageId = getCurrentNotionPageId();

    if (currentPageId) {
      rawSetItem(USER_ID_STORAGE_KEY, currentPageId);
      return currentPageId;
    }

    const newId = createUserId();
    rawSetItem(USER_ID_STORAGE_KEY, newId);
    return newId;
  }

  function getScopedStorageKey(key) {
    const keysThatNeedScoping = [
      STORAGE_THEME_KEY,
      STORAGE_NOTION_MODE_KEY
    ];

    if (keysThatNeedScoping.includes(key)) {
      return `${getUserId()}::${key}`;
    }

    return key;
  }

  function safeGetItem(key) {
    if (!storageAvailable) return null;

    try {
      return localStorage.getItem(getScopedStorageKey(key));
    } catch (error) {
      console.warn(`Could not read ${key}:`, error);
      return null;
    }
  }

  function safeSetItem(key, value) {
    if (!storageAvailable) return;

    try {
      localStorage.setItem(getScopedStorageKey(key), value);
    } catch (error) {
      console.warn(`Could not save ${key}:`, error);
    }
  }

  function safeRemoveItem(key) {
    if (!storageAvailable) return;

    try {
      localStorage.removeItem(getScopedStorageKey(key));
    } catch (error) {
      console.warn(`Could not remove ${key}:`, error);
    }
  }

  function isValidTheme(themeValue) {
    return THEMES.some((theme) => theme.value === themeValue);
  }

  function isValidLinkKey(key) {
    return VALID_LINK_KEYS.includes(key);
  }

  function getSavedTheme() {
    const saved = safeGetItem(STORAGE_THEME_KEY);
    return isValidTheme(saved) ? saved : DEFAULT_THEME;
  }

  function getSavedNotionMode() {
    const saved = safeGetItem(STORAGE_NOTION_MODE_KEY);
    return saved === "light" || saved === "dark" ? saved : DEFAULT_NOTION_MODE;
  }

  function getSavedLinks() {
    return getRawSavedLinks();
  }

  function getCurrentSettings() {
    return {
      userId: getUserId(),
      theme: getSavedTheme(),
      notionMode: getSavedNotionMode(),
      links: getSavedLinks()
    };
  }

  function applySettingsToLocal(settings = {}) {
    if (settings.links && typeof settings.links === "object") {
      rawSetItem(STORAGE_LINKS_KEY, JSON.stringify(settings.links));

      const primaryLink = settings.links.home || settings.links.settings;

      if (primaryLink) {
        rawSetItem(USER_ID_STORAGE_KEY, extractNotionPageId(primaryLink));
      }
    }

    if (settings.theme && isValidTheme(settings.theme)) {
      safeSetItem(STORAGE_THEME_KEY, settings.theme);
    }

    if (settings.notionMode === "light" || settings.notionMode === "dark") {
      safeSetItem(STORAGE_NOTION_MODE_KEY, settings.notionMode);
    }

    applyNotionMode();
  }

  async function loadCloudSettings() {
    try {
      const existingLinks = getSavedLinks();
      const primaryLink = existingLinks.home || existingLinks.settings;
      const currentPageId = getCurrentNotionPageId();

      let fetchUrl = "";

      if (primaryLink) {
        const pageId = extractNotionPageId(primaryLink);
        fetchUrl = `${API_URL}?pageId=${encodeURIComponent(pageId)}`;
      } else if (currentPageId) {
        fetchUrl = `${API_URL}?pageId=${encodeURIComponent(currentPageId)}`;
      } else {
        const userId = getUserId();
        fetchUrl = `${API_URL}?userId=${encodeURIComponent(userId)}`;
      }

      const response = await fetch(fetchUrl, {
        method: "GET"
      });

      if (!response.ok) {
        throw new Error(`Cloud load failed: ${response.status}`);
      }

      const settings = await response.json();

      if (settings && Object.keys(settings).length > 0) {
        applySettingsToLocal(settings);
      }

      cloudLoaded = true;
      return settings;
    } catch (error) {
      console.warn("Could not load cloud settings. Using local fallback:", error);
      cloudLoaded = false;
      return null;
    }
  }

  async function saveCloudSettings() {
    const settings = getCurrentSettings();

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(settings)
      });

      if (!response.ok) {
        throw new Error(`Cloud save failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.warn("Could not save cloud settings. Local backup still saved:", error);
      return null;
    }
  }

  function saveTheme(themeValue) {
    const cleanTheme = isValidTheme(themeValue) ? themeValue : DEFAULT_THEME;
    safeSetItem(STORAGE_THEME_KEY, cleanTheme);
    broadcastSync();
    saveCloudSettings();
  }

  function saveNotionMode(modeValue) {
    const cleanMode = modeValue === "light" || modeValue === "dark" ? modeValue : DEFAULT_NOTION_MODE;
    safeSetItem(STORAGE_NOTION_MODE_KEY, cleanMode);
    applyNotionMode(cleanMode);
    broadcastSync();
    saveCloudSettings();
  }

  function saveLinks(linksObject) {
    rawSetItem(STORAGE_LINKS_KEY, JSON.stringify(linksObject || {}));

    const primaryLink = linksObject.home || linksObject.settings;

    if (primaryLink) {
      const extractedId = extractNotionPageId(primaryLink);
      rawSetItem(USER_ID_STORAGE_KEY, extractedId);
    }

    broadcastSync();
    saveCloudSettings();
  }

  function resetSettings() {
    safeSetItem(STORAGE_THEME_KEY, DEFAULT_THEME);
    safeSetItem(STORAGE_NOTION_MODE_KEY, DEFAULT_NOTION_MODE);
    rawSetItem(STORAGE_LINKS_KEY, JSON.stringify({}));

    applyNotionMode(DEFAULT_NOTION_MODE);
    broadcastSync();
    saveCloudSettings();
  }

  function applyNotionMode(modeValue = getSavedNotionMode()) {
    const mode = modeValue === "light" ? "light" : "dark";

    document.documentElement.dataset.notionMode = mode;
    document.body.dataset.notionMode = mode;

    document.documentElement.style.setProperty(
      "--notion-widget-bg",
      mode === "light" ? "#ffffff" : "#191919"
    );
  }

  function cleanAssetName(assetName) {
    if (!assetName) return "";

    return String(assetName)
      .trim()
      .split("/")
      .pop()
      .split("\\")
      .pop();
  }

  function getAssetPath(themeValue, assetName) {
    const safeTheme = isValidTheme(themeValue) ? themeValue : DEFAULT_THEME;
    const safeAsset = cleanAssetName(assetName);

    return `themes/${safeTheme}/${safeAsset}`;
  }

  function assetToAltText(assetName) {
    return cleanAssetName(assetName)
      .replace(".png", "")
      .replace(/[-_]/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .trim() || "Theme image";
  }

  function parseLinksTextarea(rawText) {
    const links = {};
    const warnings = [];

    const lines = String(rawText || "")
      .split(/[\n,]+/g)
      .map((line) => line.trim())
      .filter(Boolean);

    lines.forEach((line, index) => {
      const equalsIndex = line.indexOf("=");

      if (equalsIndex === -1) {
        warnings.push(`Line ${index + 1} skipped: missing "=".`);
        return;
      }

      const key = line.slice(0, equalsIndex).trim();
      const url = line.slice(equalsIndex + 1).trim();

      if (!key || !url) {
        warnings.push(`Line ${index + 1} skipped: missing key or URL.`);
        return;
      }

      if (!isValidLinkKey(key)) {
        warnings.push(`Line ${index + 1} skipped: "${key}" is not a recognized key.`);
        return;
      }

      links[key] = url;
    });

    return { links, warnings };
  }

  function linksToTextareaValue(linksObject) {
    const links = linksObject || {};

    return VALID_LINK_KEYS
      .map((key) => (links[key] ? `${key}=${links[key]}` : ""))
      .filter(Boolean)
      .join("\n");
  }

  function initBroadcastChannel() {
    if (!("BroadcastChannel" in window)) return;

    try {
      broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
      broadcastChannel.onmessage = (event) => {
        if (event.data && event.data.type === "theme-widget-sync") {
          handleExternalSync();
        }
      };
    } catch (error) {
      console.warn("BroadcastChannel unavailable:", error);
    }
  }

  function broadcastSync() {
    if (!broadcastChannel) return;

    try {
      broadcastChannel.postMessage({
        type: "theme-widget-sync",
        theme: getSavedTheme(),
        notionMode: getSavedNotionMode(),
        links: getSavedLinks(),
        timestamp: Date.now()
      });
    } catch (error) {
      console.warn("Could not broadcast theme sync:", error);
    }
  }

  function handleExternalSync() {
    applyNotionMode();

    if (type === "control") {
      refreshControlFromStorage();
    } else {
      renderImageWidget();
    }
  }

  function startStorageListeners() {
    window.addEventListener("storage", (event) => {
      if ([STORAGE_THEME_KEY, STORAGE_LINKS_KEY, STORAGE_NOTION_MODE_KEY].includes(event.key)) {
        handleExternalSync();
      }
    });

    lastThemeSnapshot = safeGetItem(STORAGE_THEME_KEY) || "";
    lastLinksSnapshot = rawGetItem(STORAGE_LINKS_KEY) || "";
    lastNotionModeSnapshot = safeGetItem(STORAGE_NOTION_MODE_KEY) || "";

    setInterval(() => {
      const currentTheme = safeGetItem(STORAGE_THEME_KEY) || "";
      const currentLinks = rawGetItem(STORAGE_LINKS_KEY) || "";
      const currentNotionMode = safeGetItem(STORAGE_NOTION_MODE_KEY) || "";

      if (
        currentTheme !== lastThemeSnapshot ||
        currentLinks !== lastLinksSnapshot ||
        currentNotionMode !== lastNotionModeSnapshot
      ) {
        lastThemeSnapshot = currentTheme;
        lastLinksSnapshot = currentLinks;
        lastNotionModeSnapshot = currentNotionMode;
        handleExternalSync();
      }
    }, POLL_INTERVAL_MS);
  }

  function renderControlPanel() {
    document.body.classList.remove("image-mode");
    document.body.classList.add("control-mode");

    applyNotionMode();

    app.innerHTML = `
      <section class="control-shell">
        <div class="control-card">
          <header class="control-header">
            <div class="control-kicker">Reading Tracker</div>
            <h1 class="control-title">Theme Settings</h1>
            <p class="control-subtitle">
              Choose your visual theme, set your Notion appearance, and paste your generated Notion page links below.
              All theme-aware image widgets will update from this control panel.
            </p>
          </header>

          <div class="control-section">
            <label class="control-label">Theme</label>
            <div class="theme-preview-strip" id="themePreviewStrip"></div>
          </div>

          <div class="control-section">
            <label class="control-label">Notion Appearance</label>
            <div class="notion-mode-toggle" id="notionModeToggle">
              <button class="mode-pill" type="button" data-mode="light">Light Mode</button>
              <button class="mode-pill" type="button" data-mode="dark">Dark Mode</button>
            </div>
          </div>

          <div class="control-section">
            <label class="control-label" for="linksTextarea">Page links</label>
            <textarea
              class="links-textarea"
              id="linksTextarea"
              spellcheck="false"
              placeholder="settings=https://www.notion.so/...
home=https://www.notion.so/...
library=https://www.notion.so/..."
            ></textarea>
          </div>

          <div class="control-actions">
            <button class="btn btn-primary" id="saveSettingsBtn">Save Settings</button>
            <button class="btn btn-secondary" id="resetSettingsBtn">Reset Settings</button>
          </div>

          <div class="status-message" id="statusMessage" aria-live="polite"></div>
        </div>
      </section>
    `;

    refreshControlFromStorage();
    bindControlEvents();
  }

  function renderThemePills(activeTheme) {
    const strip = document.getElementById("themePreviewStrip");
    if (!strip) return;

    strip.innerHTML = THEMES
      .map((theme) => {
        const activeClass = theme.value === activeTheme ? "active" : "";
        return `
          <button
            class="theme-pill ${activeClass}"
            type="button"
            data-theme="${theme.value}"
            aria-pressed="${theme.value === activeTheme ? "true" : "false"}"
          >
            ${theme.label}
          </button>
        `;
      })
      .join("");
  }

  function renderModePills(activeMode) {
    const modeButtons = document.querySelectorAll(".mode-pill");

    modeButtons.forEach((button) => {
      const isActive = button.dataset.mode === activeMode;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  function refreshControlFromStorage() {
    const textarea = document.getElementById("linksTextarea");
    if (!textarea) return;

    const theme = getSavedTheme();
    const links = getSavedLinks();
    const notionMode = getSavedNotionMode();

    textarea.value = linksToTextareaValue(links);
    renderThemePills(theme);
    renderModePills(notionMode);
    applyNotionMode(notionMode);
  }

  function bindControlEvents() {
    if (controlEventsBound) return;
    controlEventsBound = true;

    document.addEventListener("click", (event) => {
      const themeButton = event.target.closest(".theme-pill");

      if (themeButton) {
        const selectedTheme = themeButton.dataset.theme;
        saveTheme(selectedTheme);
        renderThemePills(selectedTheme);
        showStatus("Theme saved and synced.", "success");
        return;
      }

      const modeButton = event.target.closest(".mode-pill");

      if (modeButton) {
        const selectedMode = modeButton.dataset.mode;
        saveNotionMode(selectedMode);
        renderModePills(selectedMode);
        showStatus(`Notion ${selectedMode} mode saved and synced.`, "success");
        return;
      }

      const saveBtn = event.target.closest("#saveSettingsBtn");

      if (saveBtn) {
        const textarea = document.getElementById("linksTextarea");
        const { links, warnings } = parseLinksTextarea(textarea ? textarea.value : "");

        saveLinks(links);

        if (warnings.length) {
          showStatus(`Saved with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}. Check your link format.`, "warning");
          console.warn("Theme widget link warnings:", warnings);
        } else {
          showStatus("Settings saved and synced successfully.", "success");
        }

        return;
      }

      const resetBtn = event.target.closest("#resetSettingsBtn");

      if (resetBtn) {
        resetSettings();
        refreshControlFromStorage();
        showStatus("Settings reset and synced.", "warning");
      }
    });
  }

  function showStatus(message, typeName = "") {
    const status = document.getElementById("statusMessage");
    if (!status) return;

    status.textContent = message;
    status.className = `status-message ${typeName}`;

    window.clearTimeout(showStatus.timeoutId);
    showStatus.timeoutId = window.setTimeout(() => {
      status.textContent = "";
      status.className = "status-message";
    }, 4200);
  }

  function renderImageWidget() {
    document.body.classList.remove("control-mode");
    document.body.classList.add("image-mode");

    applyNotionMode();

    const assetName = cleanAssetName(assetParam);

    if (!assetName) {
      console.warn("Theme image widget missing asset parameter.");
      app.innerHTML = `<div class="quiet-error"></div>`;
      return;
    }

    if (!VALID_ASSETS.includes(assetName)) {
      console.warn(`Unknown asset requested: ${assetName}. Attempting to load anyway.`);
    }

    const selectedTheme = getSavedTheme();
    const links = getSavedLinks();
    const linkKey = String(linkKeyParam || "").trim();
    const linkUrl = linkKey && links[linkKey] ? links[linkKey] : "";
    const imageSrc = getAssetPath(selectedTheme, assetName);
    const altText = assetToAltText(assetName);
    const layoutClass = layoutParam === "heading" ? "heading-layout" : "";

    const imageMarkup = `
      <img
        class="theme-image ${linkUrl ? "clickable" : ""}"
        id="themeImage"
        src="${imageSrc}"
        alt="${escapeHtml(altText)}"
      />
    `;

    if (linkKey && !isValidLinkKey(linkKey)) {
      console.warn(`Unknown linkKey requested: ${linkKey}`);
    }

    if (linkUrl) {
      const finalUrl = linkUrl;

      app.innerHTML = `
        <div class="image-widget ${layoutClass}">
          <a
            class="image-link-button"
            id="imageLink"
            href="${escapeAttribute(finalUrl)}"
            target="_top"
            rel="noopener noreferrer"
            aria-label="Open ${escapeAttribute(linkKey)} page"
          >
            ${imageMarkup}
          </a>
        </div>
      `;

      const linkElement = document.getElementById("imageLink");

      if (linkElement) {
        linkElement.addEventListener("click", () => {
          setTimeout(() => {
            if (document.visibilityState === "visible") {
              window.open(finalUrl, "_blank");
            }
          }, 350);
        });
      }
    } else {
      app.innerHTML = `
        <div class="image-widget ${layoutClass}">
          ${imageMarkup}
        </div>
      `;
    }

    const img = document.getElementById("themeImage");

    if (!img) return;

    img.addEventListener("error", () => {
      console.warn(`Could not load image: ${imageSrc}`);

      if (selectedTheme !== DEFAULT_THEME) {
        img.src = getAssetPath(DEFAULT_THEME, assetName);
      }
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  function renderDebugPanel() {
  document.body.classList.remove("image-mode");
  document.body.classList.add("control-mode");

  const currentPageId = getCurrentNotionPageId();
  const userId = getUserId();
  const savedLinks = getSavedLinks();

  app.innerHTML = `
    <pre style="
      white-space: pre-wrap;
      word-break: break-word;
      font-family: monospace;
      font-size: 13px;
      line-height: 1.5;
      color: white;
      background: #191919;
      padding: 16px;
      margin: 0;
      min-height: 100vh;
    ">DEBUG INFO

document.referrer:
${escapeHtml(document.referrer || "EMPTY")}

window.location.href:
${escapeHtml(window.location.href || "EMPTY")}

detected current page ID:
${escapeHtml(currentPageId || "EMPTY")}

stored user ID:
${escapeHtml(userId || "EMPTY")}

saved links:
${escapeHtml(JSON.stringify(savedLinks, null, 2))}
    </pre>
  `;
}

  async function init() {
  initBroadcastChannel();
  startStorageListeners();
  applyNotionMode();

  await loadCloudSettings();

  if (type === "debug") {
    renderDebugPanel();
  } else if (type === "control") {
    renderControlPanel();
  } else {
    renderImageWidget();
  }
}

  init();
})();
