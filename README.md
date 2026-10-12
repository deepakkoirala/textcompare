# Text Compare

A browser-based tool for comparing two or three blocks of text. Paste text into each panel and hit **Compare** (or press `Ctrl/⌘ + Enter`). Line-level and word-level differences are highlighted.

**Live app:** https://www.qwi.li/

## Features

- Side-by-side comparison of two texts, with an optional third
- Line and word level diff highlighting
- Light and dark mode
- Runs entirely in the browser; your text never leaves your machine

## Running locally

There is no build step. The app is a static site (`index.html` + `app.js`) using Tailwind CSS and Alpine.js from a CDN.

Open `index.html` directly in a browser, or serve the folder:

```bash
npx serve .
# or
python3 -m http.server 8000
```

## Deployment

The app is hosted on [Vercel](https://vercel.com) and deployed by the GitHub Actions workflow in [.github/workflows/deploy.yml](.github/workflows/deploy.yml):

| Trigger                | Result                                                       |
| ---------------------- | ------------------------------------------------------------ |
| Push to `main`         | Production deploy to https://www.qwi.li/          |
| Pull request to `main` | Preview deploy; the preview URL is posted as a PR comment    |
| Manual run             | Production deploy (Actions tab → *Deploy to Vercel* → *Run workflow*) |

### One-time setup

Add a `VERCEL_TOKEN` repository secret in GitHub (**Settings → Secrets and variables → Actions**). Create the token at https://vercel.com/account/tokens.

The project and team IDs are read from the committed `.vercel/project.json` (created by `vercel link`). The rest of `.vercel/` stays git-ignored.

If the Vercel project is also connected to this repo through Vercel's Git integration, disconnect it, or deploys will run twice.

### Manual deploy

```bash
npm i -g vercel
vercel          # preview
vercel --prod   # production
```

## License

Text Compare is open source under the [MIT License](LICENSE).
