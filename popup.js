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

  const fmtMs = (ms) => {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return m >= 60 ? fmt(m) : m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  function renderStatus() {
    chrome.storage.local.get(
      ["usage_date", "usage_ms", "break_until", "session_ms", "snooze_all"],
      (r) => {
        const limit = Number(slider.value);
        const used =
          r.usage_date === new Date().toDateString() ? r.usage_ms || 0 : 0;
        document.getElementById("used_val").textContent = fmtMs(used);
        const leftEl = document.getElementById("left_val");
        const breakLeft = (r.break_until || 0) - Date.now();
        statusEl.classList.remove("over");
        const left0 = limit * 60000 - used;
        const isLocked = breakLeft > 0 || (limit > 0 && left0 <= 0);
        document
          .querySelectorAll('input[type="checkbox"]')
          .forEach((el) => {
            el.disabled = isLocked;
            if (isLocked && el !== slider) el.checked = true;
          });
        slider.disabled = isLocked;
        if (breakLeft > 0) {
          statusEl.textContent = `Break in progress: ${fmtMs(breakLeft)} left`;
          statusEl.classList.add("over");
        } else if (limit <= 0) {
          statusEl.textContent = "Timer off — blocks always active.";
        } else {
          statusEl.textContent = "After 15 min of continuous use you get a forced 30 min break.";
        }
        if (limit <= 0) {
          leftEl.textContent = "-";
          return;
        }
        const left = Math.max(limit * 60000 - used, 0);
        leftEl.textContent = fmtMs(left);
        if (left <= 0 && breakLeft <= 0) {
          statusEl.textContent = "Time's up — blocked until tomorrow";
          statusEl.classList.add("over");
        }
      },
    );
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
  setInterval(renderStatus, 1000);
  chrome.storage.onChanged.addListener(renderStatus);
});
