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

/**
 * Loads settings from storage
 */
async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(null, (settings) => {
      userSettings = settings;
      resolve(settings);
    });
  });
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
          if (userSettings[setting]) {
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
        if (userSettings[rule.setting]) {
          const isMatch = rule.exact
            ? pathname === rule.path
            : pathname.startsWith(rule.path);
          if (isMatch) {
            window.location.replace(chrome.runtime.getURL("block.html"));
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

init();
