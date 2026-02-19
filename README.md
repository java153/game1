# Barebones 3D Baseball Hitting Sim

A simple 3D baseball hitting prototype built with **Three.js** (rendering) and **cannon-es** (physics), bundled by **Vite**.

## Project structure

- `/index.html`
- `/src/main.js`
- `/src/style.css`
- `/vite.config.js`
- `/package.json`
- `/README.md`

## Run locally

```bash
npm install
npm run dev
```

Open the local Vite URL shown in the terminal.

## Build

```bash
npm run build
npm run preview
```

Vite outputs static files into `dist/`.

## Deploy to GitHub Pages

### 1) Update Vite base path

In `vite.config.js`, set:

```js
base: '/game1/'
```

Replace `game1` with your real repository name.

### 2) Deploy options

#### Option A: GitHub Actions (recommended)

This repo includes `.github/workflows/deploy-pages.yml` which builds and deploys `dist/`.

1. Push to `main`.
2. In GitHub: **Settings → Pages → Source = GitHub Actions**.
3. Workflow deploys the built site automatically.

#### Option B: Manual deployment

1. Run `npm run build`.
2. Publish the generated `dist/` folder to `gh-pages` (or your chosen Pages branch/folder).

## Controls

- **Move mouse** and the PCI follows your cursor directly inside the strike zone.
- **Spacebar** to swing.
- **R** to reset pitch + PCI.
- **Difficulty selector (HUD):** Easy / Normal / Hard.

## Notes

- If you only open `index.html` directly as a file without Vite/build output, module resolution may fail.
- Always use `npm run dev` during development, or deploy `dist/` for production.


### Troubleshooting GitHub Actions deploys

If your Actions log says a lockfile is missing (for example around setup-node cache or `npm ci`), this repo workflow uses `npm install` so a lockfile is not required.
