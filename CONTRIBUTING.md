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
3. Run it and check the change by hand: there's no automated test suite yet. Say in the PR what you tried.
4. For anything visual, add a screenshot or a short GIF.
5. If you change behavior or the menu, update both `README.md` and `README.zh-CN.md`. The Japanese `README.ja.md` is a translation — update it too if you can, otherwise mention it in the PR.

### Code style

- Plain JavaScript, no build step. Match the style of the surrounding code.
- Code comments are in Chinese, matching the existing code. English is fine too.
- UI strings are written in Chinese in the code and translated in `clawd-pet/locales/en.json` (keyed by the Chinese text). Add an English entry for every new string.
- Clawd's look is pixel-style with no frames around elements; things that appear at the same time should share one box.

## Releasing (maintainers)

Releases are built by the **Release** workflow (`.github/workflows/release.yml`): push a tag like `v1.2.0` that matches `version` in `clawd-pet/package.json`, and it packages, signs with a Developer ID certificate, notarizes, staples and uploads `Clawd-<version>-macos-arm64.zip` to a draft release with that tag.

It needs these repository secrets (Settings → Secrets and variables → Actions):

| Secret | What it is |
| --- | --- |
| `MACOS_CERTIFICATE` | The **Developer ID Application** certificate with its private key, exported as `.p12` and base64-encoded (`base64 -i cert.p12 \| pbcopy`) |
| `MACOS_CERTIFICATE_PASSWORD` | The password set when exporting the `.p12` |
| `CLAWD_SIGN_IDENTITY` | The certificate's full name, e.g. `Developer ID Application: Your Name (TEAMID1234)` (`security find-identity -v -p codesigning`) |
| `APPLE_API_KEY` | Contents of the App Store Connect API key `.p8` file (Users and Access → Integrations → Team Keys, "Developer" access) |
| `APPLE_API_KEY_ID` | That key's Key ID |
| `APPLE_API_ISSUER` | The Issuer ID shown above the team keys list |

Instead of the three `APPLE_API_*` secrets you can notarize with an Apple ID: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` (from account.apple.com) and `APPLE_TEAM_ID`.

To sign locally, set the same variables before `npm run package` (`APPLE_API_KEY` is then the path to the `.p8` file). Without `CLAWD_SIGN_IDENTITY` it builds an unsigned app as before.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
