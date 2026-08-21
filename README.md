# dsh-theme-blackhole

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![Version](https://img.shields.io/badge/version-0.1.0-green)

English | [中文](README.zh-CN.md)

A black hole theme plugin for the dsh (DeepSeek Harness) Web UI: a WebGL real-time ray-traced Schwarzschild black hole as the application background, paired with a deep-space glass panel palette, switchable from Settings > General > Theme - Black Hole.

![hero](docs/screenshots/blackhole.png)

## Features

- **WebGL Schwarzschild black hole background**: null-geodesic ray tracing renders gravitational lensing, the accretion disk and the photon ring in real time, with a slow automatic camera orbit
- **Deep-space glass panels**: translucent dark token overrides plus backdrop blur let the black hole show through softly behind the content; the brand accent becomes accretion-disk amber
- **First-class theme**: registered into the theme runtime; the settings row toggle syncs both ways with the appearance settings, persists across reloads, and boots without flashing the default theme
- **Performance-friendly with graceful degradation**: half-resolution rendering, 30fps cap, honors the system reduced-motion preference, and falls back to a pure-black deep-space backdrop when WebGL is unavailable

## Installation

This plugin relies on the webServer service of a web profile. It only works with profiles that include a web server (such as web); **do not install it into headless profiles**.

```bash
dsh plugin --profile web add github:jiangwangyang/dsh-theme-blackhole
```

## Usage

After installing and starting, go to **Settings > General > Theme - Black Hole**:

- **Turn on**: switches to the black hole theme; the toggle is persisted and survives reloads and restarts
- **Turn off**: restores your previous built-in theme (light / dark / follow system); your original preference is never lost
- **Switch away from the appearance row**: when you switch back to a built-in theme in the appearance settings, the toggle is written back to off, keeping the two settings consistent

## How It Works

### Overall Architecture

The plugin consists of a host side and a client side, plus two static assets:

| Part        | File                   | Responsibility                                                                                                                                                                  |
|-------------|------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Host side   | `src/index.js`         | Serves `/blackhole/*` static assets (read from disk per request); registers the `theme-blackhole` settings namespace; injects boot assets into index.html when the toggle is on |
| Client side | `src/client/index.js`  | Build-free client bundle: registers the black hole theme into the ThemeRuntime, registers the settings row, and drives the DOM visuals according to theme activation            |
| Palette     | `assets/blackhole.css` | `--dsw-*` design token overrides gated by `html[data-dsh-blackhole]`                                                                                                            |
| Renderer    | `assets/blackhole.js`  | Schwarzschild black hole WebGL renderer, exposing only the `window.DshBlackhole = { start, stop }` controller                                                                   |

### Boot Injection and Gating

All theme visuals are gated by the `data-dsh-blackhole` attribute on the `html` element: the palette overrides apply while the attribute is present, and the default palette is fully restored once it is removed, leaving no residue.

- When the persisted toggle is on, the host side injects the activation marker, the stylesheet and a deferred renderer script before `</head>`, avoiding a flash of the default theme before the client plugin loads; nothing is injected when the toggle is off
- On activation the client side adopts the already-present resource tags (which carry the same marker) instead of inserting duplicates; the renderer script only defines the controller and is started/stopped idempotently by the client on `theme/change` events
- The black hole theme id is not part of ui-theme's built-in settings schema; the toggle persists in the plugin's own `theme-blackhole.enabled` namespace — a boundary dsh reserves for third-party themes

### The Black Hole Renderer (`assets/blackhole.js`)

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
- If WebGL is unavailable or shader compilation fails, the canvas layer is hidden and the fallback backdrop on body (pure black with a faint accretion-disk amber halo) shows through
- On stop, the RAF is cancelled, the GL context is proactively destroyed via `loseContext`, and the canvas layer is removed without a trace

### The Deep-Space Glass Palette (`assets/blackhole.css`)

All rules are gated by `html[data-dsh-blackhole]` and override the Web UI's `--dsw-*` design tokens:

- The canvas layer sits at `z-index: 0`, above the body background and below `#root`; `#root` applies `backdrop-filter: blur(16px)`, so translucent panels see a soft-focused black hole through the blurred backdrop
- Background tokens become layered translucent glass; higher layers (menus, popovers, toasts) are more opaque to preserve readability
- Brand and interactive accents become accretion-disk amber (`rgb(245, 158, 11)`), with a cool blue-white text gradient
- Shiki dark code-highlighting tokens are set as well; code blocks use a nearly opaque night-sky base

## Project Structure

```
.
├── cordis.patch.yml      # bundle patch: declares the plugin id and name
├── package.json          # exports, dsh.bundle / dsh.client manifest
├── src
│   ├── index.js          # host side
│   └── client
│       └── index.js      # client side (build-free)
└── assets
    ├── blackhole.css     # deep-space glass palette
    └── blackhole.js      # WebGL black hole renderer
```

## License

[MIT](./LICENSE)
