# Flow Scene Runner

A local, Brave-compatible extension that turns a storyboard timeline into a persistent,
per-scene queue of image prompts for `https://flow.google.com/`.

## Features

- Paste a full storyboard timeline; split it into scenes using `**(0:00–0:07)**` markers.
- Review the queue in the sidebar: mark scenes done with a clickable checkmark, and copy
  each scene's prompt with the copy icon.
- **Link images**: turn on **Link**, click a scene's circle, then click that scene's reference
  image on the Flow page. Linking marks the scene done and moves to the next scene
  automatically; click a linked circle to unlink. Circles appear only while Link mode is on.
  Linked images show a green tick with the matching timeline row number, so you always know
  which scene each image belongs to.
  **Pause** hides the pickers so you can keep prompting or improving in Flow, while the
  scene↔image links stay saved and linked images stay faintly marked (number still shown).
- **Download all**: downloads every linked image in timeline order, saved as `image<N>.<ext>`
  where `<N>` is the row number the image reference matches (e.g. `image3.png`, `image12.jpg`)
  into your `flow-scenes/` folder. Unlinked rows and expired images are skipped; the final
  count is shown in the panel status.
- Your timeline, queue, checkmarks, and links persist between sessions and browser restarts.
- **Refresh** wipes the panel back to a clean slate: it asks for confirmation, then clears the
  timeline, scenes, links, and all saved data, and removes link badges from the Flow page.
- Each scene row shows a small reference image of its linked photo (before the copy button);
  click it for a larger pop-up preview. Link/pause mode is remembered across browser refreshes,
  so you reopen exactly where you left off with links intact.
- Row thumbnails and the pop-up preview are read directly from the Flow page (the panel can't
  load Flow's authenticated or temporary image URLs on its own), so they stay visible while the
  image is on screen; links themselves are never lost.
- Includes the original Flow automation runner (`src/content/flow-runner.js`) that can fill
  the Flow prompt box, click Generate, wait for each new image, and download it.

## Repository layout

```
.
├── manifest.json            # (generated) MV3 manifest for the built extension
├── src/                     # source of truth
│   ├── manifest.json        # MV3 manifest (paths relative to extension root)
│   ├── background/          # service worker
│   │   └── service-worker.js# opens the side panel on action click; handles downloads
│   ├── content/             # page scripts
│   │   └── flow-runner.js   # optional Flow prompt-and-generate automator (content script)
│   └── panel/               # the side panel UI
│       ├── panel.html
│       ├── panel.css
│       └── panel.js
├── scripts/
│   └── build.js             # zero-dependency build; emits dist/
├── dist/                    # (generated, git-ignored) load this folder as unpacked
├── package.json             # npm scripts: build, watch
└── .editorconfig            # editor conventions
```

## Build & install

1. `npm run build` (or `npm run watch` while developing) to generate `dist/`.
2. Open `brave://extensions`.
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select the `dist/` folder.
5. Open Flow, then click the extension icon in the toolbar to open its side panel.

The build is a plain Node copy of `src/` into `dist/` — no bundler, no dependencies.

## Use

1. Paste your timeline. Each scene needs a marker such as `**(0:00–0:07)**`.
2. Select **Split scenes** to build the queue.
3. Mark scenes done as you work, and use the copy icon to copy a prompt into Flow.
4. To align images to scenes: select **Link**, click the circle on a timeline row, then click
   that scene's reference image on Flow. The row is marked done and the next scene is selected
   automatically. Click a linked circle to unlink and re-pick. Select **Pause** to use Flow
   normally while keeping links.

## Development

- `npm run build` — rebuild `dist/` from `src/`.
- `npm run watch` — rebuild on every change to `src/`.
- Reload the extension in `brave://extensions` (and refresh the Flow tab) after a rebuild.

## Notes

- Keep the Flow tab open and focused while the automator is working.
- The runner finds Flow's visible prompt box and closest Generate-like control at run time
  rather than relying on a brittle fixed selector; it stops a scene and retries instead of
  silently continuing if Flow's controls change unexpectedly.
- The runner does not bypass Flow limits, account checks, or safety systems.