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

## Deploy to GitHub Pages

### 1) Set the repo base path

In `vite.config.js`, update:

```js
base: '/game1/'
```

Change `game1` to your repository name.

### 2) Deploy `dist/` manually (simple)

1. Build:
   ```bash
   npm run build
   ```
2. Push the contents of `dist/` to a `gh-pages` branch (or use a Pages deploy action).
3. In GitHub repo settings, enable **Pages** and set source to that branch/folder.

### Optional: GitHub Actions deployment

You can also use the standard GitHub Pages Actions workflow (`actions/upload-pages-artifact` + `actions/deploy-pages`) to deploy `dist/` on every push to `main`.

---

### Controls

- **Left click on bat** to grab.
- **Drag mouse left/right** to swing.
- **Release mouse** to let bat settle.
- **R key** resets ball + bat target angle.
