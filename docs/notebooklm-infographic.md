# agent-launch — NotebookLM infographic workflow

Google NotebookLM has no public API for infographics; generate the hero manually, then import it into the showcase.

## 1. Create the infographic

1. Go to https://notebooklm.google.com/ and create a notebook.
2. **Add sources:** upload `SOURCES.md` from this folder and the [agent-launch README](https://raw.githubusercontent.com/dhruv-anand-aintech/agent-launch/main/README.md).
3. Open **Studio → Infographic** → pencil icon:
   - Orientation: **Landscape**
   - Detail: **Standard**
   - Style: **Professional** (or Sketch Note)
   - Prompt: paste the contents of `NOTEBOOKLM-PROMPT.txt`
4. Generate, then **Download** the PNG (⋮ menu).

## 2. Import into showcase

From the repo root:

```sh
node scripts/import-notebooklm-hero.mjs agent-launch /path/to/downloaded.png
npm run embed:github-social
npm run generate:showcase
```

## 3. Update agent-launch README

```sh
cp artifacts/showcase-hero-assets/github-social/agent-launch.webp /path/to/agent-launch/docs/assets/agent-launch-hero.webp
```

Add under the `# agent-launch` heading:

```markdown
![agent-launch — unified CLI for coding agents](docs/assets/agent-launch-hero.webp)
```

Commit and push `agent-launch` and this showcase repo.
