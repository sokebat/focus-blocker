/**
 * CLEAN & SCALABLE CONTENT SCRIPT FOR PUREFOCUS
 * Handles element hiding via CSS injection and powerful redirects.
 */

const CONFIG = {
  facebook: {
    domain: "facebook.com",
    elements: {
      fb_reels: [
        '[aria-label="Reels"]',
        'a[href*="/reels/"]',
        'a[href*="/reel/"]',
        'a[href*="/watch/"]',
        'div[aria-label="Reels tray"]',
        '[data-pagelet="Reels"]',
      ],
      fb_marketplace: [
        '[aria-label="Marketplace"]',
        'a[href*="/marketplace/"]',
      ],
    },
    redirects: [
      { path: "/reels", setting: "fb_reels" },
      { path: "/reel", setting: "fb_reels" },
      { path: "/watch", setting: "fb_reels" },
      { path: "/", exact: true, setting: "fb_feed" }, // Full redirect for home page
    ],
  },
  youtube: {
    domain: "youtube.com",
    elements: {
      yt_shorts: {
        selectors: [
          'ytd-guide-entry-renderer:has(a[href="/shorts"])',
          'ytd-mini-guide-entry-renderer:has(a[href="/shorts"])',
          "#shorts-container",
          "ytd-reel-shelf-renderer",
          'a[href^="/shorts"]',
        ],
      },
      yt_recommended: {
        selectors: [
          "#related",
          "ytd-watch-next-secondary-results-renderer",
          'ytd-browse[page-subtype="home"] #contents',
        ],
      },
    },
    redirects: [{ path: "/shorts", setting: "yt_shorts" }],
  },
  instagram: {
    domain: "instagram.com",
    elements: {
      ig_reels: [
        'a[href*="/reels/"]',
        'a[href*="/reels/videos/"]',
        'svg[aria-label="Reels"]',
      ],
    },
    redirects: [{ path: "/reels", setting: "ig_reels" }],
  },
};

let userSettings = {};
let injectedStyleElement = null;
let snoozeTimer = null;

function snoozeKey(setting) {
  return `snooze_${setting}`;
}

const MAX_LIMIT_MIN = 90;
const FLUSH_MS = 5000;
let pendingMs = 0;

function today() {
  return new Date().toDateString();
}

/** Daily watch-time budget in ms (0 = no budget, always block). Capped at 90 min. */
function budgetMs() {
  const min = Number(userSettings.time_limit_min) || 0;
  return Math.min(Math.max(min, 0), MAX_LIMIT_MIN) * 60 * 1000;
}

function usedMs() {
  const stored =
    userSettings.usage_date === today() ? userSettings.usage_ms || 0 : 0;
  return stored + pendingMs;
}

function budgetExhausted() {
  return budgetMs() > 0 && usedMs() >= budgetMs();
}

/**
 * Whether a given setting is currently unblocked: either the daily budget
 * still has time left, or (with no budget set) a snooze is active.
 * Once the budget is used up, nothing is unblocked for the rest of the day.
 */
function isSnoozed(setting) {
  if (budgetMs() > 0) return !budgetExhausted();
  const until = userSettings[snoozeKey(setting)];
  return typeof until === "number" && Date.now() < until;
}

function anyBlockEnabledHere() {
  const hostname = window.location.hostname;
  return Object.values(CONFIG).some(
    (data) =>
      hostname.includes(data.domain) &&
      [
        ...Object.keys(data.elements || {}),
        ...(data.redirects || []).map((r) => r.setting),
      ].some((k) => userSettings[k]),
  );
}

/** Adds elapsed watch time to today's total in local storage. */
function flushUsage() {
  if (!pendingMs) return;
  const delta = pendingMs;
  pendingMs = 0;
  chrome.storage.local.get(["usage_date", "usage_ms"], (r) => {
    const base = r.usage_date === today() ? r.usage_ms || 0 : 0;
    chrome.storage.local.set({ usage_date: today(), usage_ms: base + delta });
  });
}

function startUsageTimer() {
  let lastTick = Date.now();
  let lastFlush = Date.now();
  setInterval(() => {
    const now = Date.now();
    const elapsed = Math.min(now - lastTick, 2000);
    lastTick = now;

    const counting =
      budgetMs() > 0 &&
      !budgetExhausted() &&
      document.visibilityState === "visible" &&
      anyBlockEnabledHere();
    if (counting) pendingMs += elapsed;

    if (budgetMs() > 0 && budgetExhausted() && !blockedAfterBudget) {
      blockedAfterBudget = true;
      flushUsage();
      if (handleRedirects()) return;
      updateInjectedStyles();
    }
    if (now - lastFlush >= FLUSH_MS) {
      lastFlush = now;
      flushUsage();
    }
  }, 1000);
}

let blockedAfterBudget = false;

/**
 * Schedules a re-check for the moment the soonest active snooze expires,
 * so blocking resumes automatically without waiting for navigation/polling.
 */
function scheduleSnoozeExpiry() {
  if (snoozeTimer) {
    clearTimeout(snoozeTimer);
    snoozeTimer = null;
  }

  const now = Date.now();
  let nextExpiry = Infinity;
  for (const key in userSettings) {
    if (key.startsWith("snooze_")) {
      const until = userSettings[key];
      if (typeof until === "number" && until > now && until < nextExpiry) {
        nextExpiry = until;
      }
    }
  }

  if (nextExpiry !== Infinity) {
    snoozeTimer = setTimeout(async () => {
      await loadSettings();
      if (handleRedirects()) return;
      updateInjectedStyles();
      scheduleSnoozeExpiry();
    }, nextExpiry - now + 250);
  }
}

/**
 * Loads settings from storage.
 * Toggle settings live in sync storage; temporary snooze timers live in
 * local storage since they're ephemeral and shouldn't sync across devices.
 */
async function loadSettings() {
  const [syncSettings, localSettings] = await Promise.all([
    new Promise((resolve) => chrome.storage.sync.get(null, resolve)),
    new Promise((resolve) => chrome.storage.local.get(null, resolve)),
  ]);
  userSettings = { ...syncSettings, ...localSettings };
  return userSettings;
}

/**
 * Injects CSS to hide elements instantly
 */
function updateInjectedStyles() {
  const hostname = window.location.hostname;
  let css = "";

  for (const [platform, data] of Object.entries(CONFIG)) {
    if (hostname.includes(data.domain)) {
      if (data.elements) {
        for (const [setting, config] of Object.entries(data.elements)) {
          if (userSettings[setting] && !isSnoozed(setting)) {
            const selectors = Array.isArray(config) ? config : config.selectors;
            selectors.forEach((selector) => {
              css += `${selector} { display: none !important; }\n`;
            });
          }
        }
      }
    }
  }

  if (!injectedStyleElement) {
    injectedStyleElement = document.createElement("style");
    injectedStyleElement.id = "pure-focus-dynamic-styles";
    (document.head || document.documentElement).appendChild(
      injectedStyleElement,
    );
  }
  injectedStyleElement.textContent = css;
}

/**
 * Handles redirects based on settings and path
 */
function handleRedirects() {
  const hostname = window.location.hostname;
  const pathname = window.location.pathname;

  for (const [platform, data] of Object.entries(CONFIG)) {
    if (hostname.includes(data.domain) && data.redirects) {
      for (const rule of data.redirects) {
        if (userSettings[rule.setting] && !isSnoozed(rule.setting)) {
          const isMatch = rule.exact
            ? pathname === rule.path
            : pathname.startsWith(rule.path);
          if (isMatch) {
            const blockUrl = new URL(chrome.runtime.getURL("block.html"));
            blockUrl.searchParams.set("return", window.location.href);
            blockUrl.searchParams.set("setting", rule.setting);
            window.location.replace(blockUrl.toString());
            return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * Main initialization
 */
async function init() {
  await loadSettings();

  if (handleRedirects()) return;

  updateInjectedStyles();
  scheduleSnoozeExpiry();
  blockedAfterBudget = budgetExhausted();
  startUsageTimer();

  // Monitor for navigation in SPAs
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      if (handleRedirects()) return;
      updateInjectedStyles();
    }
  }, 500);
}

// Listen for settings changes from popup
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SETTINGS_CHANGED") {
    userSettings = { ...userSettings, ...message.settings };
    updateInjectedStyles();
    handleRedirects();
  }
});

// Keep limit/usage in sync across tabs and with the popup
chrome.storage.onChanged.addListener((changes, area) => {
  let touched = false;
  for (const [k, c] of Object.entries(changes)) {
    if (k === "time_limit_min" || k.startsWith("usage_") || k.startsWith("snooze_")) {
      userSettings[k] = c.newValue;
      touched = true;
    }
  }
  if (touched) {
    blockedAfterBudget = budgetExhausted();
    if (!handleRedirects()) updateInjectedStyles();
  }
});

init();
