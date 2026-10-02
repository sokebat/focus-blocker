document.addEventListener("DOMContentLoaded", () => {
  const options = [
    "fb_feed",
    "fb_reels",
    "fb_marketplace",
    "yt_shorts",
    "yt_recommended",
    "ig_reels",
  ];

  // Load saved settings
  chrome.storage.sync.get(options, (result) => {
    options.forEach((option) => {
      const element = document.getElementById(option);
      if (element) {
        // Default to false if not set, except maybe some defaults?
        // Let's default to false for now so user explicitly enables them.
        element.checked = result[option] || false;
      }
    });
  });

  // Save settings on change
  options.forEach((option) => {
    const element = document.getElementById(option);
    if (element) {
      element.addEventListener("change", () => {
        chrome.storage.sync.set({ [option]: element.checked }, () => {
          console.log(`Setting ${option} saved: ${element.checked}`);

          // Optionally notify content script if needed,
          // but content script will check storage on load/navigation.
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
              try {
                const result = chrome.tabs.sendMessage(tabs[0].id, {
                  type: "SETTINGS_CHANGED",
                  settings: { [option]: element.checked },
                });
                // Ignore error if content script not loaded
                if (result && typeof result.catch === "function") {
                  result.catch(() => {
                    console.log("Content script not active on this tab");
                  });
                }
              } catch (err) {
                console.log("Content script not active on this tab");
              }
            }
          });
        });
      });
    }
  });

  // Daily watch timer (capped at 90 minutes)
  const MAX = 90;
  const slider = document.getElementById("time_limit_min");
  const valEl = document.getElementById("time_limit_val");
  const statusEl = document.getElementById("timer_status");
  const fmt = (m) =>
    m <= 0 ? "Off" : m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`;

  function renderStatus() {
    chrome.storage.local.get(["usage_date", "usage_ms"], (r) => {
      const limit = Number(slider.value);
      if (limit <= 0) {
        statusEl.textContent = "Timer off — blocks always active.";
        statusEl.classList.remove("over");
        return;
      }
      const used =
        r.usage_date === new Date().toDateString() ? r.usage_ms || 0 : 0;
      const left = Math.max(limit * 60000 - used, 0);
      const mins = Math.ceil(left / 60000);
      statusEl.textContent =
        left > 0 ? `${fmt(mins)} left today` : "Time's up — blocked until tomorrow";
      statusEl.classList.toggle("over", left <= 0);
    });
  }

  chrome.storage.sync.get("time_limit_min", (r) => {
    slider.value = Math.min(Number(r.time_limit_min) || 0, MAX);
    valEl.textContent = fmt(Number(slider.value));
    renderStatus();
  });
  slider.addEventListener("input", () => {
    const v = Math.min(Number(slider.value), MAX);
    valEl.textContent = fmt(v);
    chrome.storage.sync.set({ time_limit_min: v }, renderStatus);
  });
  setInterval(renderStatus, 2000);
});
