# Extension Website

Landing page, installation guide, and docs for the Browser Agent Chrome extension.

Built with Next.js 15 + Tailwind CSS. Brand colors match the extension UI.

## Development

```bash
pnpm install
pnpm dev       # http://localhost:3000
```

## Adding screenshots & videos

All placeholder sections are marked with `[ ... ]` comments in the source.

| File to add | Used in |
|---|---|
| `public/screenshots/step-1-download.png` | Install guide, Step 1 |
| `public/screenshots/step-2-extract.png` | Install guide, Step 2 |
| `public/screenshots/step-3-developer-mode.png` | Install guide, Step 3 |
| `public/screenshots/step-4-load-unpacked.png` | Install guide, Step 4 |
| `public/screenshots/step-5-pin.png` | Install guide, Step 5 |
| `public/screenshots/step-6-options.png` | Install guide, Step 6 |
| `public/screenshots/step-7-connected.png` | Install guide, Step 7 |

For the homepage demo: embed a `<video>` or `<iframe>` in `src/app/page.tsx` inside the demo section.

For the architecture diagram: replace the placeholder in `src/app/docs/page.tsx` with an `<Image>` pointing to `public/architecture.png`.

## Deploy to AgentBase

```bash
# Build image
docker build --platform linux/amd64 -t vcr.vngcloud.vn/<repo>/extension-website:latest .

# Push
docker push vcr.vngcloud.vn/<repo>/extension-website:latest

# Create runtime (first time)
bash ../../.claude/skills/agentbase/scripts/runtime.sh create \
  --name "claw-a-thon-extension-website" \
  --image "vcr.vngcloud.vn/<repo>/extension-website:latest" \
  --flavor "1x1-general" \
  --env-file .env \
  --from-cr

# Update (subsequent deploys)
bash ../../.claude/skills/agentbase/scripts/runtime.sh update <runtime-id> \
  --image "vcr.vngcloud.vn/<repo>/extension-website:latest" \
  --from-cr
```
