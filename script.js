(() => {
  "use strict";

  const STORAGE_THEME_KEY = "selectedTheme";
  const STORAGE_LINKS_KEY = "themeLinks";
  const CHANNEL_NAME = "reading-tracker-theme-sync";

  const DEFAULT_THEME = "default";
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

  const app = document.getElementById("app");

  let broadcastChannel = null;
  let lastThemeSnapshot = "";
  let lastLinksSnapshot = "";

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

  function safeGetItem(key) {
    if (!storageAvailable) return null;

    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.warn(`Could not read ${key}:`, error);
      return null;
    }
  }

  function safeSetItem(key, value) {
    if (!storageAvailable) return;

    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.warn(`Could not save ${key}:`, error);
    }
  }

  function safeRemoveItem(key) {
    if (!storageAvailable) return;

    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn(`Could not remove ${key}:`, error);
    }
  }

  function getSavedTheme() {
    const saved = safeGetItem(STORAGE_THEME_KEY);
    return isValidTheme(saved) ? saved : DEFAULT_THEME;
  }

  function getSavedLinks() {
    const raw = safeGetItem(STORAGE_LINKS_KEY);
    if (!raw) return {};

    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      console.warn("Saved links were invalid JSON:", error);
      return {};
    }
  }

  function saveTheme(themeValue) {
    const cleanTheme = isValidTheme(themeValue) ? themeValue : DEFAULT_THEME;
    safeSetItem(STORAGE_THEME_KEY, cleanTheme);
    broadcastSync();
  }

  function saveLinks(linksObject) {
    safeSetItem(STORAGE_LINKS_KEY, JSON.stringify(linksObject || {}));
    broadcastSync();
  }

  function isValidTheme(themeValue) {
    return THEMES.some((theme) => theme.value === themeValue);
  }

  function isValidLinkKey(key) {
    return VALID_LINK_KEYS.includes(key);
  }

  function cleanAssetName(assetName) {
    if (!assetName) return "";

    // Prevent paths like ../ or nested folders from URL params.
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
      .split(/\r?\n/g)
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

      if (!/^https?:\/\//i.test(url)) {
        warnings.push(`Line ${index + 1} skipped: URL must start with http:// or https://.`);
        return;
      }

      links[key] = url;
    });

    return { links, warnings };
  }

  function linksToTextareaValue(linksObject) {
    const links = linksObject || {};

    return VALID_LINK_KEYS
      .map((key) => {
        return links[key] ? `${key}=${links[key]}` : "";
      })
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
        links: getSavedLinks(),
        timestamp: Date.now()
      });
    } catch (error) {
      console.warn("Could not broadcast theme sync:", error);
    }
  }

  function handleExternalSync() {
    if (type === "control") {
      refreshControlFromStorage();
    } else {
      renderImageWidget();
    }
  }

  function startStorageListeners() {
    window.addEventListener("storage", (event) => {
      if ([STORAGE_THEME_KEY, STORAGE_LINKS_KEY].includes(event.key)) {
        handleExternalSync();
      }
    });

    lastThemeSnapshot = safeGetItem(STORAGE_THEME_KEY) || "";
    lastLinksSnapshot = safeGetItem(STORAGE_LINKS_KEY) || "";

    setInterval(() => {
      const currentTheme = safeGetItem(STORAGE_THEME_KEY) || "";
      const currentLinks = safeGetItem(STORAGE_LINKS_KEY) || "";

      if (currentTheme !== lastThemeSnapshot || currentLinks !== lastLinksSnapshot) {
        lastThemeSnapshot = currentTheme;
        lastLinksSnapshot = currentLinks;
        handleExternalSync();
      }
    }, POLL_INTERVAL_MS);
  }

  function renderControlPanel() {
    document.body.classList.remove("image-mode");
    document.body.classList.add("control-mode");

    app.innerHTML = `
      <section class="control-shell">
        <div class="control-card">
          <header class="control-header">
            <div class="control-kicker">Reading Tracker</div>
            <h1 class="control-title">Theme Settings</h1>
            <p class="control-subtitle">
              Choose your visual theme and paste your generated Notion page links below.
              All theme-aware image widgets will update from this control panel.
            </p>
          </header>

          <div class="control-section">
            <label class="control-label" for="themeSelect">Theme</label>
            <select class="theme-select" id="themeSelect"></select>
            <div class="theme-preview-strip" id="themePreviewStrip"></div>
          </div>

          <div class="control-section">
            <label class="control-label" for="linksTextarea">Page links</label>
            <textarea
              class="links-textarea"
              id="linksTextarea"
              spellcheck="false"
              placeholder="home=https://www.notion.so/...
library=https://www.notion.so/...
tbrlibrary=https://www.notion.so/..."
            ></textarea>
            <div class="helper-text">
              Paste one link per line using this format: <strong>key=url</strong>.
              Blank lines are ignored.
            </div>
          </div>

          <div class="control-actions">
            <button class="btn btn-primary" id="saveSettingsBtn">Save Settings</button>
            <button class="btn btn-secondary" id="resetSettingsBtn">Reset Settings</button>
          </div>

          <div class="status-message" id="statusMessage" aria-live="polite"></div>
        </div>
      </section>
    `;

    populateThemeSelect();
    refreshControlFromStorage();
    bindControlEvents();
  }

  function populateThemeSelect() {
    const select = document.getElementById("themeSelect");
    if (!select) return;

    select.innerHTML = THEMES
      .map((theme) => `<option value="${theme.value}">${theme.label}</option>`)
      .join("");
  }

  function renderThemePills(activeTheme) {
    const strip = document.getElementById("themePreviewStrip");
    if (!strip) return;

    strip.innerHTML = THEMES
      .map((theme) => {
        const activeClass = theme.value === activeTheme ? "active" : "";
        return `<span class="theme-pill ${activeClass}">${theme.label}</span>`;
      })
      .join("");
  }

  function refreshControlFromStorage() {
    const select = document.getElementById("themeSelect");
    const textarea = document.getElementById("linksTextarea");

    if (!select || !textarea) return;

    const theme = getSavedTheme();
    const links = getSavedLinks();

    select.value = theme;
    textarea.value = linksToTextareaValue(links);
    renderThemePills(theme);
  }

  function bindControlEvents() {
    const select = document.getElementById("themeSelect");
    const textarea = document.getElementById("linksTextarea");
    const saveBtn = document.getElementById("saveSettingsBtn");
    const resetBtn = document.getElementById("resetSettingsBtn");

    select.addEventListener("change", () => {
      saveTheme(select.value);
      renderThemePills(select.value);
      showStatus("Theme saved. Your image widgets should update automatically.", "success");
    });

    saveBtn.addEventListener("click", () => {
      const selectedTheme = select.value;
      const { links, warnings } = parseLinksTextarea(textarea.value);

      saveTheme(selectedTheme);
      saveLinks(links);
      renderThemePills(selectedTheme);

      if (warnings.length) {
        showStatus(`Saved with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}. Check your link format.`, "warning");
        console.warn("Theme widget link warnings:", warnings);
      } else {
        showStatus("Settings saved successfully.", "success");
      }
    });

    resetBtn.addEventListener("click", () => {
      safeRemoveItem(STORAGE_THEME_KEY);
      safeRemoveItem(STORAGE_LINKS_KEY);
      refreshControlFromStorage();
      broadcastSync();
      showStatus("Settings reset to default.", "warning");
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
      app.innerHTML = `
        <div class="image-widget">
          <a
            id="imageLink"
            href="${escapeAttribute(linkUrl)}"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open ${escapeAttribute(linkKey)} page"
          >
            ${imageMarkup}
          </a>
        </div>
      `;
    } else {
      app.innerHTML = `
        <div class="image-widget">
          ${imageMarkup}
        </div>
      `;
    }

    const img = document.getElementById("themeImage");

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

  function init() {
    initBroadcastChannel();
    startStorageListeners();

    if (type === "control") {
      renderControlPanel();
    } else {
      renderImageWidget();
    }
  }

  init();
})();