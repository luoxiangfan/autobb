# AutoAds YP Session Capture Extension

This extension supports Chrome and Edge (Chromium).

## Package Content

- `manifest.json`
- `popup.html`
- `popup.js`
- `background.js`
- `icons/` (`icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`)

## Local Install (Developer Mode)

1. Open extension management page.
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder: `extensions/yp-session-capture`.

## Usage

1. Login to `yeahpromos.com` or `www.yeahpromos.com`.
2. Keep an AutoAds `/products` tab logged in and active.
3. Click extension icon, then click `回传 YeahPromos 登录态`.
4. Return to `/products`, click `刷新登录态`.

## Notes

- The extension reads cookies under both `https://yeahpromos.com/*` and `https://*.yeahpromos.com/*`.
- Session submit endpoint: `/api/products/yeahpromos/session/capture-extension`.
