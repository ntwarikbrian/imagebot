# Xdown

Sidebar extension for Brave/Chrome that finds every video on a page, lets you mark
the ones you want with a checkmark overlay, and downloads them.

## Features

- **Auto-detection** — scans the whole page (not just what's on screen): visible and
  hidden `<video>` elements, `blob`/`data` sources, shadow-DOM players and same-origin
  iframes appear in the sidebar in page order, refreshing as new videos load.
- **Search page** — click *Search page* to deep-scan the current page: it scrolls
  through the entire document to wake lazy-loaded videos and lists everything found.
- **Link overlay from Flow Scene Runner** — click *Link videos on the page*, then
  click videos (or their corner badge) on the site. Each linked video gets a green
  ✓ badge. Clicking again unlinks. Pause dims the badges but keeps the marks.
- **Per-row download** — download any single video straight from the sidebar.
- **Download all (N)** — batch-downloads every linked video as
  `video1.<ext>`, `video2.<ext>`, … into `Downloads/xdown/`, with progress and a
  list of any failures.
- **Persisted links** — linked state and Link/Pause mode survive page refreshes.

## Install (development)

1. Run `npm run build` in this folder (zero dependencies; Node 20+).
2. Open `brave://extensions` (or `chrome://extensions`), enable **Developer mode**.
3. **Load unpacked** → select the `dist/` folder.
4. Click the Xdown icon (or pin it to the toolbar) — the sidebar opens. Navigate
   to a page with videos; they appear in the sidebar automatically.

After editing `src/`, run `npm run build` again and press the reload button on the
extension card.

## How downloads work

- `https` video sources are downloaded by the browser downloader (streams large
  files; renames to `videoN.<ext>`).
- `blob:` / `data:` sources are fetched as bytes and saved the same way.
- HLS (`m3u8`) streams usually cannot be saved as a single file; those rows will
  report a reason instead of a silent failure.

## Notes

- Clicking a video while in *Link* mode will also toggle its link, so use that
  mode only when you want to select videos.
- To skip an element from detection, add the `data-xdown-skip` attribute.
- Links are stored per-extension globally, not per-site.