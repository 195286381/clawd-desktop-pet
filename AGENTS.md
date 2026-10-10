# AGENTS.md

Clawd Pet: an Electron + three.js desktop pet for macOS (Apple silicon) that shows Claude Code sessions, permission prompts and quota. Human-facing docs are in [README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md); this file covers what an agent needs on top of them.

## Layout

All app code lives in `clawd-pet/`. Plain JavaScript, no build step, no framework.

- `main.js`: main process. Transparent always-on-top window covering the work area, tray / Dock menus, settings (`userData/settings.json`), the local hooks server on `127.0.0.1:47615` (`POST /hook`, `POST /permission`), installing hooks into `~/.claude/settings.json`, jumping to a session's terminal tab.
- `pet.js`: renderer entry. It only imports the modules in `renderer/` (plain ES modules, loaded directly by the page) and starts the loop; the header comment lists what each module holds.
- `renderer/`: one feature per file: `scene` / `model` (three.js scene, Clawd's mesh, faces, props), `animation` (per-frame pose and physics), `behavior` (picking actions, clinging), `input`, `loop`, `bubble`, `hud` (quota bar), `quota` (usage panel, moods), `sessions` / `crabs` (Claude Code sessions, head crabs, details), `perm`, `reactions`, `fx`, `reminders`, `chatter`, `sfx`, `commands` (IPC commands from the main process), `i18n` (`t()` and formatters).
- `renderer/state.js`: an exported `let` is read-only to other modules, so state that several modules assign lives on two shared objects: `prefs` (menu settings) and `state` (runtime). Anything assigned in only one module stays a plain `let` there and is exported for reading.
- `cc.js`: the Claude Code hooks logic that doesn't need Electron (editing the hooks config, turning hook JSON into events, parsing transcripts, permission replies). `main.js` does the file / HTTP / window side and calls into it.
- `usage.js`: reads `~/.claude/projects/**/*.jsonl` for token / cost stats (`PRICES` table) and gets quota limits by running `claude -p /usage` and parsing its output.
- `preload.js`: the only bridge between the two processes (`window.pet`). New IPC goes here plus an `ipcMain` handler in `main.js`.
- `locales/en.json`: English strings keyed by the Chinese source text.
- `test/`: unit tests (`node --test`) for `usage.js` and `cc.js`.
- `build/`: icon and tray image scripts plus `extend-info.plist` for packaging.

## Run and verify

```bash
cd clawd-pet && npm install && npm start
npm run package   # dist/Clawd-darwin-arm64/Clawd.app
```

- `npm test` (node:test) and `npm run lint` (ESLint, bug-catching rules only, no style rules) run on Linux without Electron; GitHub Actions runs both on every PR. Keep logic you want tested out of `main.js` (which requires Electron at load) and in `cc.js` / `usage.js`.
- Tests don't cover the UI or Electron glue: still verify those by running the app.
- Only one instance can run. If the installed Clawd is open, use `CLAWD_HOOK_PORT=47616 npm start`.
- Never let a dev run modify the real `~/.claude/settings.json`: use `CLAWD_CC_SETTINGS=/tmp/s.json`.
- Shortcuts for checking states: `CLAWD_SELFTEST=1|usage|cling`, `CLAWD_FAKE_QUOTA`, `CLAWD_FAKE_WEEK`, `CLAWD_FAKE_ETA`, `CLAWD_DEMO=1` (sample data, use it for README screenshots), `CLAWD_LANG=en|zh`. See the README's Development section.
- Runtime errors are logged to `~/Library/Application Support/Clawd/clawd.log`.

## Conventions

- Code comments and commit messages are in Chinese, matching the existing history.
- UI strings are written in Chinese in code via `t('中文')`; add the English entry to `locales/en.json` for every new or changed string.
- Visual style: pixel art, no frames or borders around elements, things placed relative to Clawd's position and facing (e.g. crabs ride on its head). Information shown at the same time goes in one combined box. When a look is uncertain, propose options before building.
- When behavior or menus change, update `README.md` and `README.zh-CN.md`; update `README.ja.md` too or say it is out of date.
- Keep everything local: Clawd makes no network requests of its own and never reads Claude login credentials; quota comes only from the `claude` CLI.
- Hooks Clawd installs must stay `async` (except permission approval) and fail silently when Clawd isn't running, so Claude Code is never slowed down.
- Clawd is Anthropic's mascot; the code is MIT but the character is not. Don't add Anthropic logos or wording that implies endorsement.
