<p align="center">
  <img src="clawd-pet/build/icon.png" width="112" alt="Clawd icon">
</p>

<h1 align="center">Clawd Pet</h1>

<p align="center">
  <b>A tiny 3D Clawd that lives on your macOS desktop and keeps an eye on Claude Code for you.</b><br>
  It wears your sessions on its head, taps you when Claude needs you, cheers when your tests pass,<br>
  and shows how much quota you have left — without ever getting in your way.
</p>

<p align="center">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-Apple%20silicon-111?logo=apple&logoColor=white">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white">
  <img alt="three.js" src="https://img.shields.io/badge/three.js-000?logo=threedotjs&logoColor=white">
  <img alt="Made for Claude Code" src="https://img.shields.io/badge/made%20for-Claude%20Code-D97757">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

<p align="center"><b>English</b> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a></p>

<p align="center"><img src="docs/hero.gif" width="532" alt="Clawd with three session crabs on its head: one needs approval and shows a red '!', tests pass and confetti flies, then it reports 'Claude is done ✅'"></p>

## Why Clawd?

You kick off a few Claude Code sessions, switch to something else, and then… one of them has been waiting for your approval for 20 minutes. Clawd fixes that, and it's pretty cute while doing it.

<table>
<tr><td width="230">🦀 <b>Your sessions, on its head</b></td><td>Each running Claude Code session is a little pixel crab riding on Clawd. Red with a <code>!</code> means it needs you. Hover Clawd to see them all; <b>click a crab to jump straight to that terminal tab.</b></td></tr>
<tr><td width="230">✋ <b>Approve from the desktop</b></td><td>When Claude wants to run a tool, approve it in a bubble above Clawd — or just press <kbd>⌥⌘Y</kbd> / <kbd>⌥⌘N</kbd>.</td></tr>
<tr><td width="230">🔋 <b>Quota at a glance</b></td><td>A pixel HP bar shows your 5-hour and weekly quota. Clawd's mood follows it: lively when you have plenty, sleepy when it's running out.</td></tr>
<tr><td width="230">🎉 <b>Reacts to your work</b></td><td>Confetti when tests pass, a rocket jump on <code>git push</code>, a shiver before <code>rm -rf</code>.</td></tr>
<tr><td width="230">💤 <b>Catches you up</b></td><td>Step away and Clawd naps. When you're back, it tells you what you missed.</td></tr>
<tr><td width="230">🪶 <b>Never in your way</b></td><td>Clicks pass straight through, it never steals keyboard focus, and it sips battery.</td></tr>
</table>

Everything runs locally. Clawd **never reads your login credentials**, and checking quota **doesn't call a model or use any quota**.

## Quick start

Requires macOS on Apple silicon and the [Claude Code](https://code.claude.com) CLI (signed in — it's used to check your quota).

### Download

1. Download `Clawd-<version>-macos-arm64.zip` from the [latest release](https://github.com/195286381/clawd-pet/releases/latest), unzip it, and move `Clawd.app` to **Applications**
2. The app isn't notarized, so macOS may say it's damaged or can't be opened. Run this once in Terminal:
   ```bash
   xattr -dr com.apple.quarantine /Applications/Clawd.app
   ```
3. Open Clawd

### Build from source

Also needs [Node.js](https://nodejs.org).

```bash
git clone https://github.com/195286381/clawd-pet.git
cd clawd-pet/clawd-pet
npm install
npm run package && ditto dist/Clawd-darwin-arm64/Clawd.app /Applications/Clawd.app
open /Applications/Clawd.app
```

> A self-built app isn't signed either. It runs fine on the Mac that built it; if you copy it to another Mac, right-click it and choose **Open** the first time.

Want to try it without installing? Run `npm start` inside `clawd-pet/` instead.

### Set it up

From Clawd's menu (right-click the menu bar icon):

1. **Claude Code → Connect Claude Code (task alerts)** — turns on session crabs, alerts and reactions for newly started sessions
2. **Settings → Launch at login** — so Clawd is always around
3. Optional: **Claude Code → Approve permissions on Clawd**

> **Language:** Clawd speaks **English** and **Simplified Chinese**. It follows your system language; switch any time under **Language / 语言**. Menu names below also give the Chinese in brackets.

---

## Working with Claude Code

### Session crabs

<p align="center"><img src="docs/session-crabs.png" width="490" alt="Session crabs riding on Clawd's head; the red one with a '!' needs your approval. Right: while clinging to the edge they turn with Clawd"></p>

Every active Claude Code session is a pixel crab on Clawd's head (up to 4; each extra session shows as a pixel dot in its state's color). Sessions waiting for you come first.

| Crab | Meaning |
|---|---|
| Grey | Thinking |
| Rust, bobbing gently | Working |
| Red with a pixel `!`, hopping | Needs your approval / waiting for your reply |
| Green | Just finished |
| Red | Stopped with an error |

A crab also shows how full that session's context is: it gets chubbier at 75% of the way to auto-compact, and chubbier still with a bead of sweat at 90% (hover shows the percentage). The point where Claude Code auto-compacts follows `CLAUDE_CODE_AUTO_COMPACT_WINDOW` if you set it.

- **Hover** Clawd or the crabs to open the session box: every session, including ones that finished and are waiting for your reply, with its title (as shown in the Claude app's sidebar or set with /rename; the project folder if it has none), what it's doing and for how long. Each row starts with a little crab in that session's color, and your quota sits in the top row. With no sessions you just get the quota bar, and nothing pops up while you're carrying Clawd. If Clawd is in the middle of saying something, its bubble steps aside while the box is open and finishes afterwards.
- Clawd stays put while you look. Move the cursor into the box and the crab for the row you point at lifts up and hops.

<p align="center"><img src="docs/session-details.png" width="351" alt="The session box above Clawd: the quota on top, then one row per session with a pixel crab in its state's color, what it's doing and for how long"></p>

- **Click a crab, or a row in that box** (including sessions shown as dots), to jump to that session: iTerm / Terminal switch to the exact tab (macOS asks once for Automation permission); the Claude app opens that exact session; VS Code, Ghostty and others are brought to the front. Sessions started before you connected Clawd need to be reopened once.
- **Restarting Clawd** (an update, launch at login) doesn't lose sessions that are mid-task: on launch it reads session logs written in the last 30 minutes and brings back the ones still running a tool or still thinking. Until such a session sends its next event, clicking its crab only brings its app to the front.
- Finished and errored crabs leave after a minute — and they don't just vanish:

<p align="center"><img src="docs/crabs-leave.gif" width="480" alt="A green crab hops off Clawd's head, waves and crawls away; a red crab flips belly-up, wiggles, then crawls away"></p>

A finished crab hops off, waves and crawls away; an errored one flips belly-up, wiggles, then crawls off. When idle, Clawd now and then crouches and bounces the crabs on its head. When it clings to the screen edge, the crabs turn with it.

### Alerts

In **newly started** Claude Code sessions:

- **Claude is working** — Clawd pulls out a little laptop and works along with you; its self-talk says what Claude is doing, e.g. "Claude is running a command: npm test…"
- **A reply is done** (tasks over 15 s) — Clawd jumps and reports "Claude is done ✅" with the project name
- **Claude needs approval / is waiting for you / has a question** — Clawd waves, e.g. "🙋 Wants to use Bash — needs your approval"
- **Still waiting** — after 3 minutes it waves again, then every 5 minutes, at most 3 times
- **A tool call fails** — Clawd goes `x x` for a moment (no bubble; small failures are common)
- **Claude stops with an error** — Clawd cries and tells you "⚠️ Claude stopped with an error"
- **Context almost full** (90%) — once per session: "🦀 Context is almost full (92%), auto-compact is coming"
- **Compacting context** — an open cardboard box appears over Clawd's head and sheets of paper fly in; when compaction is done the box gets taped shut, Clawd hops, and the chubby crab slims back down
- **While you were away** — after 5 idle minutes Clawd lies down to sleep; when you're back it sums up what you missed, e.g. "While you were away: 🙋 api-server needs your approval (waiting 12 min) / ✅ clawd finished"
- **Several at once** — alerts that arrive close together go into one bubble, one under another; alerts that come in while an approval bubble is open wait until you've answered it

### Reactions

<p align="center"><img src="docs/reactions.gif" width="420" alt="Four reactions: confetti when tests pass, a rocket jump with smoke on git push, shivering before rm -rf, slumping with a crying face when tests fail"></p>

| Claude runs… | Clawd… |
|---|---|
| Tests that pass (`npm test`, `pytest`, `go test`, `cargo test`, …) | jumps with star eyes and throws confetti |
| Tests that fail | slumps with a crying face |
| A successful `git push` | launches like a rocket in a puff of smoke |
| `rm -rf` | shivers and sweats |
| `git push --force` | shivers longer, dizzy eyes |
| `git commit` | a small happy hop |
| `npm install`, `pip install`, … | a few boxes drop onto its head |
| A build that succeeds (`npm run build`, `cargo build`, `make`, …) | hops and sparkles |
| A build that fails | slumps with a crying face |
| `docker build` / `run` / `up` | winks and blows blue bubbles |
| `sudo` | frowns

Each reaction plays at most once every 15 seconds, and not while Clawd is clinging to an edge, sleeping or being dragged.

### Approve permissions on Clawd

Off by default — turn it on under **Claude Code → Approve permissions on Clawd** (在 Clawd 上批准权限); it applies to sessions you open afterwards.

When Claude needs approval to use a tool and that session's window isn't in front, Clawd pops up a bubble showing the project and the tool (the full command for Bash), with **Allow / Deny / Go to terminal**. Press <kbd>⌥⌘Y</kbd> to allow or <kbd>⌥⌘N</kbd> to deny (these keys are only taken while a request is waiting). When Claude Code offers a rule, there's also **Always allow**, with the rule and where it's saved underneath (e.g. `Bash(npm test:*) · this project`) — the same as choosing "don't ask again" in the terminal. To deny and tell Claude why, type a reason in the box at the bottom and press Return. Several requests come one at a time. When Claude asks you a multiple-choice question, the bubble shows the question and its options instead: click an option, pick several and press **OK** for multi-select questions, or type your own answer in the box at the bottom and press Return. If you're already looking at that session, Clawd stays out of it; if you don't answer within 60 seconds, or Clawd is hidden or in full click-through, the request goes back to Claude Code's usual prompt.

### How the connection works

Connecting adds a few hooks to `~/.claude/settings.json`. Clawd only appends its own entries, backs up the original as `settings.json.clawd-backup`, and removes its entries when you untick the option. Apart from permission approval (which waits for your click), every hook runs in the background (`async`) and never slows Claude Code down: it `curl`s the event to `127.0.0.1:47615` and exits silently if Clawd isn't running. Each alert can be switched off in the same menu. Upgrading from an older version? Clawd adds any new hooks on launch.

---

## Usage and quota

<p align="center"><img src="docs/usage-panel.png" width="296" alt="Pixel-style usage panel (sample data)"></p>

Click Clawd (or **View usage** 查看用量) for a pixel usage panel (sample data above):

| What | Where it comes from |
|---|---|
| Remaining % and reset time of the 5-hour and weekly quotas | The official `claude -p "/usage"` — the same numbers as `/usage` in Claude Code |
| Cost and tokens for today, the last 7 days and the current 5-hour window, plus per-model share | Your local session logs in `~/.claude/projects/`, priced at Anthropic API rates |
| Recent sessions (up to 5) with their state and duration; click one to jump to it | Claude Code hooks, updated every second while the panel is open |

- The quota check **doesn't call a model, use quota, or leave a session behind**. It runs at launch and every 5 minutes (opening the panel refreshes data older than a minute)
- Cost is an **estimate** at API prices — on a subscription you aren't billed this way
- Subscription quotas exist only on Pro / Max; with an API key, only the cost estimate is shown
- The panel stays open while the cursor is on it
- **Forecast:** from your recent pace, the panel says "used up in about 40 min" or "will last until the reset", and Clawd warns you once if the quota looks set to run out within 45 minutes

**Quota bar.** The 10 cells above Clawd are the 5-hour quota; the small ring is the weekly quota. Below 20% the percentage appears, below 10% it blinks; hovering shows both percentages. When you have sessions, hovering Clawd shows the quota in the session box instead. Choose **Always show** / **Show on hover** / **Off** under **Appearance → Quota bar** (外观 → 血条).

**Mood follows your quota** (whichever of the two is lower):

| Remaining | Mood | What you'll see |
|---|---|---|
| ≥ 50% | Full of energy | Normal activity |
| 20 – 50% | A bit busy | Sweats now and then, sometimes flops down |
| 10 – 20% | Tired | Half-closed eyes, walks slowly, naps often |
| < 10% | Running on empty | Dimmer color, trembles, sweats; reminds you every 15 min |
| Used up | Out of quota | Cries, then puts on a nightcap and sleeps |

When the quota resets, it dances to celebrate. Without quota data (API key), the first three moods use the 5-hour cost estimate ($8 / $25). Thresholds are the `LEVEL_*` constants in [`clawd-pet/pet.js`](clawd-pet/pet.js).

**Daily recap.** After 6 PM, the first time Clawd is free it hands you a little report for the day: sessions, how long Claude worked, tests passed, commits and pushes, estimated cost and the busiest project. On Fridays it covers the week (Monday to today). The usage panel shows the same counts under **Today** and **Last 7 days**. Counts come from the hooks and are kept for 14 days in `stats.json` next to the settings. Turn it off under **Claude Code → Daily recap after work (weekly on Fridays)**.

**Break reminders.** After 60 minutes of continuous Claude Code use (configurable), Clawd stretches and nudges you to get up. The timer restarts after a 10-minute pause in Claude Code, or after you've been away from your keyboard and mouse for 10 minutes (even if Claude kept working); there are no reminders while you're away.

---

## A pet, not a widget

<p align="center"><img src="docs/showcase.png" width="760" alt="Clawd in different states: quota bar overhead, reporting a finished task, talking to itself, being petted, looking cool, typing on a laptop with you, sleeping when quota runs out, Halloween outfit"></p>

- **Lives on your desktop** — strolls along the bottom of the screen, looks around, hops, waves; its eyes follow your mouse
- **Play with it** — click and it pops up the usage panel; drag it and it flails; toss it hard and it bounces and gets dizzy; rest the cursor on it for heart eyes; poke it 4 times and it gets annoyed
- **Edge-cling mode** — drop it at the left or right edge and it hangs there sideways, just peeking out; it leans out when the cursor comes near
- **Lots of faces** — `> <`, `^ ^`, `x x`, sunglasses, heart eyes, star eyes, `$ $`, crying, winking…
- **Props** — nightcap, party hat, headphones, a laptop while you code, morning coffee; a witch hat for Halloween, Santa hat for Christmas, red scarf for Lunar New Year
- **Self-talk** — remarks on the time of day, your quota and how hard you've been working, in pixel speech bubbles with the [Ark Pixel](https://github.com/TakWolf/ark-pixel-font) font
- **Optional 8-bit sound** — synthesized blips for hops, landings and alerts (off by default)
- **Five sizes** — mini / small / medium / large / extra large

### Stays out of your way

- Clicks anywhere except on Clawd pass straight through. When the cursor merely passes over, Clawd turns see-through; it only becomes clickable after the cursor rests on it for ~0.1 s
- Its window **never takes focus** — your typing always goes to your app
- Keep working near it and it walks away to give you room
- **Full click-through** mode: Clawd ignores the mouse entirely
- **Light on battery:** 60 fps only while moving, 20 fps standing still, 12 fps asleep, capped at 30 fps on battery or in **Power saving**. Measured on an M-series MacBook: about 24% CPU roaming, 14% standing still; zero while hidden

<details>
<summary><b>Full menu reference</b></summary>

Clawd has icons in the menu bar and the Dock (you can turn the Dock icon off). Left-click the menu bar icon to hide / show Clawd; click the Dock icon to bring it back or make it hop. Right-click either icon for the full menu:

- Hide / show Clawd, View usage
- **Actions** (动作): hop, wave, dance, peek around, take a walk, stretch
- **Position** (位置): cling to the screen edge / leave the edge, back to the center
- **Claude Code**: connect Claude Code (task alerts), alert when a reply is done, alert when it needs approval / is waiting, show session crabs, approve permissions on Clawd, daily recap after work
- **Appearance** (外观): size, quota bar, when the mouse passes over (go see-through / fade slightly / no change), holiday outfits
- **Settings** (设置): self-talk (chatty / normal / quiet / silent), break reminder (off / 45 / 60 / 90 min), sound effects, power saving, free roaming, full click-through, show icon in Dock, launch at login
- **Language / 语言**: follow system / 中文 / English
- Quit Clawd (menu bar icon's menu)

Settings are saved in `~/Library/Application Support/Clawd/settings.json`.

</details>

<details>
<summary><b>Troubleshooting</b></summary>

- If the animation ever stalls, Clawd restarts it within about 2 seconds; if the page crashes, it reloads
- Errors are logged to `~/Library/Application Support/Clawd/clawd.log` (last ~200 KB). Attach it when reporting a problem
- Still odd? Quit and reopen Clawd from the menu bar icon
- To update, quit Clawd from its menu first, then download the new release and repeat the Download steps (or, if you built it yourself, rerun the `npm run package && ditto …` line)

</details>

<details>
<summary><b>Development</b></summary>

```bash
cd clawd-pet
npm install
npm start
```

These switches only work with `npm start` (unpackaged):

```bash
CLAWD_SELFTEST=1 npm start       # hide after 4 s, show again after 8 s
CLAWD_SELFTEST=usage npm start   # pop up the usage panel after 3 s
CLAWD_SELFTEST=cling npm start   # cling to the screen edge after 3 s
CLAWD_SELFTEST=report npm start  # hand over today's recap after 3 s (report-week for the weekly one)
CLAWD_FAKE_QUOTA=7 npm start     # pretend only 7% of the 5-hour quota is left, to see each mood
CLAWD_FAKE_WEEK=30 npm start     # pretend only 30% of the weekly quota is left, to see the ring
CLAWD_FAKE_QUOTA=30 CLAWD_FAKE_ETA=25 npm start   # pretend the quota runs out in 25 min at this pace
CLAWD_HOOK_PORT=47616 npm start  # use another port for the hooks endpoint (while the installed Clawd is running)
CLAWD_CC_SETTINGS=/tmp/s.json npm start           # "Connect Claude Code" edits this file instead of your real settings
CLAWD_DEMO=1 npm start           # fixed sample data (for README screenshots, without exposing real usage)
CLAWD_LANG=en npm start          # force the interface language (en / zh) without changing your settings
```

Check the usage statistics on their own: `cd clawd-pet && node usage.js`

```
clawd-pet/
├── clawd-pet/                 the desktop pet (Electron + three.js)
│   ├── main.js                main process: transparent always-on-top window, click-through, menu bar / Dock, usage scheduling, Claude Code hooks
│   ├── preload.js             bridge between the main process and the page
│   ├── index.html             page and styles for the pixel dialog boxes / usage panel / quota bar
│   ├── pet.js                 3D model, motion, physics, interaction, moods
│   ├── usage.js               local usage statistics + subscription quota check
│   ├── trayTemplate*.png      menu bar icons
│   ├── locales/en.json        English UI strings (keyed by the original Chinese text)
│   ├── fonts/                 pixel font (Ark Pixel Font 12px, Simplified Chinese, + OFL license)
│   └── build/                 app icon (Blender render script + compositing script) and the menu bar icon script
├── README.md                  English README
├── README.zh-CN.md            Chinese README
├── README.ja.md               Japanese README
└── docs/                      images for the README (captured with CLAWD_DEMO=1 sample data)
```

Regenerate the app icon (needs Blender and Pillow):

```bash
cd clawd-pet
/Applications/Blender.app/Contents/MacOS/Blender -b -P build/render_icon.py
python3 build/make_icon.py
```

Regenerate the menu bar icon (needs Pillow): `python3 build/make_tray.py`

</details>

<details>
<summary><b>Where the design and motion come from</b></summary>

- **Look**: based on Clawd's quadrant-block ASCII art in Claude Code, the official Anthropic Clawd animations (short videos posted by [@claudeai](https://x.com/claudeai)), and the 3D-printed Clawd: a square, sturdy body, flat arms, four thin legs in two pairs (each a slab running front to back), and small square eyes. The legs are a bit longer than the reference so it moves more lively
- **Legs**: each leg is a hip-to-foot column; feet stay planted once they touch the ground. When peeking, the body leans forward and the legs slant like a parallelogram; when walking, the two pairs step alternately; in the air the legs dangle with limited stretch
- **Motion**: damped springs with anticipation, squash and stretch, and a bounce on landing — inspired by [Codrops' frame-by-frame breakdown of the official animations](https://tympanus.net/codrops/2026/05/05/reverse-engineering-claude-ais-mascot-animations-with-svg-and-gsap/)

</details>

## Notes

Clawd is Anthropic's mascot. This is a personal hobby project, not affiliated with or endorsed by Anthropic.

Text in the bubbles, usage panel and quota bar uses the [Ark Pixel Font](https://github.com/TakWolf/ark-pixel-font) 12px Simplified Chinese edition, © TakWolf, licensed under the [SIL Open Font License 1.1](clawd-pet/fonts/ark-pixel-OFL.txt).

## Contributing

Bug reports, ideas and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Found a security problem? Please follow [SECURITY.md](SECURITY.md).

## License

The code is released under the [MIT License](LICENSE). The Clawd character itself belongs to Anthropic and is not covered by this license.
