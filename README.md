# PureFocus Chrome Extension

A premium Chrome extension designed to help users maintain deep focus by blocking distracting content across popular social media platforms.

## Project Structure

```
focus-blocker/
├── manifest.json      # Extension configuration and metadata
├── background.js      # Service worker for background tasks
├── content.js         # Content script for URL monitoring and redirection
├── block.html         # Blocked content page template
├── rules.json         # Declarative network request rules
└── _metadata/         # Extension metadata directory
```

## Features

- Blocks access to:
  - YouTube Shorts
  - Facebook Watch
  - Instagram Reels
  - Snapchat Spotlight
- Automatic redirection to a block page when attempting to access blocked content
- Works with Single Page Applications (SPAs)
- Declarative network request rules for efficient blocking

## Technical Details

### Manifest (manifest.json)

- Uses Manifest V3
- Implements declarative network request rules
- Includes content scripts for dynamic content monitoring
- Permissions:
  - declarativeNetRequest
  - scripting
  - Host permissions for target domains

### Content Script (content.js)

- Monitors URL changes in real-time
- Implements path-based blocking logic
- Uses MutationObserver for SPA compatibility
- Redirects to block.html when blocked content is detected

### Block Rules (rules.json)

- Contains declarative network request rules
- Enables efficient content blocking at the network level

### Block Page (block.html)

- Custom page shown when blocked content is accessed
- Accessible as a web resource

## Installation

1. Clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the extension directory

## Usage

Once installed, the extension will automatically:

- Block access to short-form video content on supported platforms
- Redirect to a block page when attempting to access blocked content
- Work seamlessly with both traditional and single-page applications

## Development

The extension is built using:

- Chrome Extension Manifest V3
- JavaScript for content scripts
- Declarative Network Request API for efficient blocking
