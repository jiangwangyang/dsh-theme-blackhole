# dsh-theme-blackhole

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![Version](https://img.shields.io/badge/version-0.2.0-green)

English | [中文](README.zh-CN.md)

A black hole theme plugin for the DeepSeek Harness (dsh) Web UI: a WebGL real-time ray-traced Schwarzschild black hole as the application background, paired with a deep-space glass panel palette. There is no toggle: the theme is enabled while the plugin is installed, and disabling or removing the plugin restores the default theme without residue.

![hero](docs/screenshots/blackhole.png)

## Features

- **WebGL Schwarzschild black hole background**: null-geodesic ray tracing renders gravitational lensing, the accretion disk and the photon ring in real time, with a slow automatic camera orbit
- **Deep-space glass panels**: translucent dark token overrides plus backdrop blur let the black hole show through softly behind the content; the brand accent becomes accretion-disk amber
- **Token override layer, always on**: the palette stacks onto the active theme through the theme service's token override layer (`ctx.theme.overrideTokens`), orthogonal to the light/dark/system preference — the plugin never reads or writes the appearance preference, and unloading retracts the layer automatically; the stylesheet and renderer are inlined into the client bundle — no server routes, no index.html injection, no globals
- **Performance-friendly with graceful degradation**: half-resolution rendering, 30fps cap, honors the system reduced-motion preference, and falls back to a pure-black deep-space backdrop when WebGL is unavailable

## Installation

The theme is purely browser-side and has no host-side service dependencies.

Requires dsh ≥ 0.1.0-rc.7 (the release that introduced the theme service's token override layer, `ctx.theme.overrideTokens`). Version 0.1.x of this plugin — the one with the settings toggle — requires dsh ≥ 0.1.7.

```bash
dsh plugin --profile web add github:jiangwangyang/dsh-theme-blackhole
```

## Usage

There is no settings toggle: the black hole theme is enabled as soon as the plugin loads.

- **Turn off**: disable or remove the plugin (`dsh plugin --profile web remove dsh-theme-blackhole`); the token override layer is retracted and every DOM trace is removed, restoring your previous appearance (light / dark / follow system) exactly as it was
- **Appearance setting**: the light/dark/system preference remains yours to change; the black hole palette renders identically on top of any of them

## How It Works

### Overall Architecture

The theme is purely browser-side: the host side is an empty implementation (the bundle loader imports every row's node half), and all logic lives in a single build-free client bundle:

| Part        | Location | Responsibility |
|-------------|----------|----------------|
| Host side   | `src/index.js` | Empty implementation; exports only the stable plugin name |
| Token layer | `PALETTE` / `TOKENS` (`src/client/index.js`) | Stacks the deep-space glass palette over the active theme through `ctx.theme.overrideTokens` |
| Structure   | `STRUCTURE_CSS` (inlined stylesheet, formerly `assets/blackhole.css`) | Canvas layer (built-in soft focus and fallback backdrop), page-wide body dimming veil and shiki tokens gated by `html[data-dsh-blackhole]` |
| Renderer    | `createBlackholeRenderer()` (inlined, formerly `assets/blackhole.js`) | Schwarzschild black hole WebGL renderer; the factory returns a closure-based `{ start, stop }` controller |

### Gating

All structural visuals are gated by the `data-dsh-blackhole` attribute on the `html` element: while the attribute is present the canvas layer, backdrop blur and shiki tokens apply; removing it restores everything, leaving no residue.

- The stylesheet and renderer are inlined into the client bundle and arrive with the client plugin — no static asset routes, no index.html injection, no `window` global controller; the trade-off is a possible brief flash of the default theme before the bundle loads
- The palette does not live in CSS: the client stacks it through `ctx.theme.overrideTokens('blackhole', tokens)`, and the theme runtime writes the tokens as inline variables on `body`, folded into every `theme/change` snapshot. The layer is orthogonal to the light/dark/system preference — the plugin never registers a theme id nor reads/writes the preference — and unloading the plugin retracts the layer automatically
- Because the black hole palette is a single deep-space scheme rendered under any preference, the client asserts a dark rendering baseline (inline `color-scheme: dark` and the dark base palette attribute) after every `theme/change` — a presentation-only write that never touches the stored preference — and restores the preference-resolved baseline on unload
- The renderer is a module-local closure; the client starts it on activation and stops it (RAF cancel + GL context destruction + canvas removal) on unload
### The Black Hole Renderer (`createBlackholeRenderer`, inlined in `src/client/index.js`)

For each pixel, the renderer casts a ray from the camera and performs null-geodesic (photon trajectory) ray tracing in Schwarzschild spacetime, entirely within the fragment shader.

**Orbital equation and integration.** In the Schwarzschild metric, conservation of angular momentum confines each light ray to a plane through the black hole's center, so there is no need to integrate the full 3D geodesic equations. Introducing the dimensionless quantity `u = r_s / r` (where `r_s = 2M` is the Schwarzschild radius) reduces the geodesic to a scalar orbital equation:

```
d^2u/dphi^2 = 1.5 u^2 - u
```

where `phi` is the azimuthal angle within the orbital plane. The shader constructs an orthonormal basis `(a, b)` for the orbital plane from the camera position and ray direction, derives the initial values `u0` and `du/dphi` from the angle of incidence, then integrates with classical fourth-order Runge-Kutta (RK4) for up to 420 steps. The step size adapts to `u` (`dphi = 0.04 / (1 + 2.5u)`): steps shrink near the black hole to preserve accuracy in the strongly curved region, without wasting work far away.

Integration terminates in three ways:

- `u <= 0`: the ray escapes to infinity and samples the starfield background
- `u >= 1` (`r < r_s`): the ray crosses the event horizon and is captured; the pixel is black
- The ray has passed periapsis, is heading outward, and is farther than the camera's initial distance: early escape, saving steps

**Gravitational lensing.** Because rays follow curved trajectories, the line of sight for a single pixel may wind around the black hole multiple times, so images of the accretion disk appear above and below the black hole (lensed images) and form an Einstein ring — these effects are not post-processing textures but a natural consequence of geodesic integration.

**Accretion disk.** Each integration step checks for crossings of the disk plane (tilted 20 degrees) via a sign change of the normal dot product, then locates the intersection by linear interpolation and shades it:

- Matter orbits at the Keplerian angular velocity `Omega = sqrt(M / r^3)`; inside the ISCO (`3 r_s`) lies a plunging region with strong shear and inflow
- The density is tangentially stretched spiral fbm turbulence noise
- The temperature profile follows `T ~ r^(-3/4)`, scaled with mass by the astrophysical law `T ~ M^(-1/4)`; color comes from an approximate blackbody spectrum

**Relativistic transfer.** Disk shading accounts for first-order relativistic effects:

- **Doppler beaming**: the Doppler factor `dop = 1 / (gamma (1 - beta cos))` is computed from the Keplerian velocity; the side moving toward the observer brightens significantly and shifts blue, with a `dop^3` term in the brightness
- **Gravitational redshift**: `g_grav = sqrt(1 - r_s / r)`; photons near the horizon lose energy, and the color physically shifts with the total redshift factor `g = dop * g_grav`
- Plunging matter dims and reddens as it falls into the horizon

**Photon ring glow.** Each ray's periapsis distance is recorded; rays whose periapsis grazes the photon sphere (`r = 1.5 r_s`) receive a warm glow overlay, outlining the photon ring.

**Remaining components.** An exponentially decaying volumetric haze glows above and below the disk; the starfield background consists of a galactic-band nebula (fbm noise) plus two layers of hashed stars, sampled after gravitational bending so the background stars are lensed too. The final color goes through exposure, ACES tone mapping and gamma correction.

**Camera and performance.** Fixed parameters (mass `M = 0.5`, camera distance 11, pitch 0.38 rad, 50-degree field of view); the camera orbits slowly at 0.05 rad/s, with no interaction and no tunables. Performance strategy:

- The render resolution is `0.5 x devicePixelRatio` (capped at 2) times the window size — half-resolution rendering balances performance and clarity, with the browser upscaling to fullscreen
- The RAF loop is capped at 30fps; it skips rendering but not timing, so the orbit speed is unaffected
- When the system reduced-motion preference is on, only a single static frame is rendered and the loop never starts
- If WebGL is unavailable or shader compilation fails, only the canvas is removed; the layer stays and its own pure-black deep-space fallback backdrop shows through
- On stop, the RAF is cancelled, the GL context is proactively destroyed via `loseContext`, and the canvas layer is removed without a trace

### The Deep-Space Glass Palette (`PALETTE` token override layer + `STRUCTURE_CSS`)

The palette is delivered as a token override layer over the Web UI's `--dsw-*` design tokens (stacked via `ctx.theme.overrideTokens`, each token supplying the same value for both palette modes); the structural rules in the inlined `STRUCTURE_CSS` stylesheet are gated by `html[data-dsh-blackhole]`:

- The canvas layer sits at `z-index: -1`, sunk below the body and all app content — no official mount node is touched, and overlay/menu/toast ordering is unaffected; the layer carries its own fallback backdrop and a `filter: blur(16px)` soft focus, so translucent panels see a soft-focused black hole
- Background tokens become layered translucent glass; higher layers (menus, popovers, toasts) are more opaque to preserve readability. `--dsw-alias-bg-base` is fully transparent: several full-height app-shell containers (AppFrame, center column, conversation skeleton) paint it in nested stacks, and any non-zero alpha would compound into a black scrim over the canvas; page-wide dimming is instead carried by a single fixed-alpha dark veil the gated stylesheet paints on body — body paints once without nesting, so nothing compounds
- Brand and interactive accents become accretion-disk amber (`rgb(245, 158, 11)`), with a cool blue-white text gradient
- Shiki dark code-highlighting tokens are set as well; code blocks use a nearly opaque night-sky base

## Project Structure

```
.
├── cordis.patch.yml      # bundle patch: declares the plugin id and name
├── package.json          # exports, dsh.bundle / dsh.client manifest
└── src
    ├── index.js          # host side (empty implementation)
    └── client
        └── index.js      # client side (build-free single-file bundle: palette + structure CSS + WebGL renderer)
```

## License

[MIT](./LICENSE)
