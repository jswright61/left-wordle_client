# Testing Responsive Layout

## Safari — Responsive Design Mode

Best choice for checking how the site looks on iOS, since it uses the same engine as Mobile Safari.

1. Open the page in Safari.
2. Enable the Develop menu if you haven't: **Safari → Settings → Advanced → Show features for web developers**.
3. Press **Shift+Cmd+R** (or **Develop → Enter Responsive Design Mode**).
4. Use the device picker at the top to select a preset (iPhone SE, iPhone 15 Pro, iPad, etc.) or drag the edge of the viewport to any width.
5. Toggle portrait/landscape with the rotation button next to the device picker.

Useful widths to check:

| Device | Width |
|---|---|
| iPhone SE | 375px |
| iPhone 14 / 15 | 390px |
| iPhone 14 Plus / 15 Plus | 430px |
| iPad mini | 744px |

---

## Chrome (or Edge) — DevTools Device Mode

Chrome's device emulation has a richer toolbar than Safari's and lets you throttle the network and CPU to simulate a slower phone. The rendering engine differs from Mobile Safari, so use this alongside Safari, not instead of it.

1. Open the page in Chrome.
2. Open DevTools with **Cmd+Opt+I**.
3. Click the **phone/tablet icon** in the DevTools toolbar (or press **Cmd+Shift+M**) to enter Device Mode.
4. Use the **Dimensions** dropdown at the top of the page to pick a device preset, or set a custom width/height.
5. Click the **Rotate** button to switch portrait/landscape.
6. Use the **Throttling** dropdown (top-right of the page area) to simulate a slower mobile connection if testing load performance.

To inspect a specific element's layout in Device Mode: right-click the element on the page and choose **Inspect**, then use the **Computed** tab in DevTools to see resolved padding, margin, and sizing values.

---

## Connecting a Real iPhone via USB

This gives you a Safari Web Inspector session pointed at a real device — actual viewport size, real touch behavior, real iOS keyboard, and real rendering. It's the most accurate test you can do.

### One-time setup

1. On your iPhone, go to **Settings → Safari → Advanced** and enable **Web Inspector**.
2. On your Mac, make sure the Develop menu is enabled in Safari (see above).
3. Connect your iPhone to your Mac with a USB cable.
4. When prompted on the iPhone, tap **Trust** (if it appears).

### Inspecting a page

1. Open the page in Safari on your iPhone.
2. In Safari on your Mac, open the **Develop** menu — your iPhone's name appears as a submenu.
3. Hover over your iPhone's name and select the tab you want to inspect.
4. A standard Safari Web Inspector window opens, live-connected to the page on your phone.

You can edit CSS live in the inspector (changes appear immediately on the phone), use the Elements panel to inspect layout, and use the Console for JS.

### iOS-specific things to check

- **Virtual keyboard**: tap a text field (like the share text additions inputs on the Settings screen) and verify the visible content area reflows correctly when the keyboard appears.
- **Scroll behavior**: scroll through a long page (like Settings) and confirm only the intended container scrolls — not the background game content underneath.
- **Overscroll / bounce**: scroll past the top or bottom of a scroll container and check that the bounce doesn't expose content that should be hidden.
- **Safe areas**: on notched/Dynamic Island iPhones, check that content isn't clipped by the notch or home indicator. Use `env(safe-area-inset-*)` CSS variables if needed.
