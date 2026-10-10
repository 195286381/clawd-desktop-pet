# Contributing to Clawd Pet

Thanks for wanting to help Clawd! Bug reports, ideas and pull requests are all welcome. Issues and PRs can be written in English or Chinese (中文也可以).

## Reporting bugs and asking for features

- Search [existing issues](https://github.com/195286381/clawd-pet/issues) first.
- For bugs, use the **Bug report** template and attach `~/Library/Application Support/Clawd/clawd.log` if you can.
- For ideas, use the **Feature request** template. Screenshots or sketches of how Clawd should look help a lot.

## Development setup

Requires macOS on Apple silicon, [Node.js](https://nodejs.org) and the [Claude Code](https://code.claude.com) CLI.

```bash
git clone https://github.com/195286381/clawd-pet.git
cd clawd-pet/clawd-pet
npm install
npm start
```

If the installed Clawd is running, quit it first (only one instance can run), or use `CLAWD_HOOK_PORT=47616 npm start`. The README's **Development** section lists the `CLAWD_*` switches for faking quota, sample data and more. Use `CLAWD_CC_SETTINGS=/tmp/s.json` so testing "Connect Claude Code" doesn't touch your real `~/.claude/settings.json`.

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Keep each PR focused on one change.
3. Run `npm test` and `npm run lint` in `clawd-pet/` (CI runs both on every PR), then run the app and check the change by hand. The tests only cover logic that doesn't need Electron (`usage.js`, `cc.js`); put new testable logic there and add a test in `clawd-pet/test/`. Say in the PR what you tried.
4. For anything visual, add a screenshot or a short GIF.
5. If you change behavior or the menu, update both `README.md` and `README.zh-CN.md`. The Japanese `README.ja.md` is a translation — update it too if you can, otherwise mention it in the PR.

### Code style

- Plain JavaScript, no build step. Match the style of the surrounding code.
- Code comments are in Chinese, matching the existing code. English is fine too.
- UI strings are written in Chinese in the code and translated in `clawd-pet/locales/en.json` (keyed by the Chinese text). Add an English entry for every new string.
- Clawd's look is pixel-style with no frames around elements; things that appear at the same time should share one box.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
