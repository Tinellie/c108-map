# Circle Viewer (React + MUI)

This app displays crawled circle data from your scraper database output API.

## Start

```bash
cd viewer-app
npm install
npm run dev
```

## Build

```bash
npm run build
```

## API configuration

Create `viewer-app/.env` if needed:

```bash
VITE_CIRCLES_API_URL=http://localhost:3000/api/favorite-circles
VITE_IMAGE_BASE_URL=http://localhost:3000
```

- `VITE_CIRCLES_API_URL`: endpoint returning circle list (array or `{ data: [...] }`)
- `VITE_IMAGE_BASE_URL`: optional prefix for local image paths

If API is unavailable, the app automatically falls back to mock data so UI can still be previewed.
