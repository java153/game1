# Barebones 3D Baseball Hitting Sim

A simple static-site baseball hitting prototype built with **Three.js** + **cannon-es** + **Vite**.

## Features

- 3D scene with ground, home plate, bat, and pitched ball.
- Physics world with gravity and bat/ball collisions.
- Mouse-driven bat swing using a **dynamic bat body + hinge constraint motor**.
- Repeating pitch loop with ball reset conditions.
- Tiny HUD showing last hit speed and travel distance.

## Run locally

```bash
npm install
npm run dev
```

Then open the local Vite URL shown in your terminal.

## Build for production

```bash
npm run build
npm run preview
```

Production files are generated in `dist/`.

## Important GitHub Pages note (this is what caused blank page)

If you use Vite, GitHub Pages should publish the **built site** (`dist` artifact), not raw source files.

### Correct deployment option (recommended)

This repo includes a Pages workflow: `.github/workflows/deploy-pages.yml`.

1. Push to `main`.
2. In GitHub: **Settings → Pages → Build and deployment → Source = GitHub Actions**.
3. The workflow builds with Vite and deploys `dist` automatically.

### If you deploy manually

- Run `npm run build`.
- Publish the generated `dist/` output.

## Vite base path

`vite.config.js` uses:

```js
base: './'
```

This relative base avoids repo-name/path mismatches and works for GitHub Pages subpaths.

---

### Controls

- **Left click on bat** to grab.
- **Drag mouse left/right** to swing.
- **Release mouse** to let bat settle.
- **R key** resets ball + bat target angle.
