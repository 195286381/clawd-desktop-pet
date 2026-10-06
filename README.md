<p align="center">
  <img src="clawd-pet/build/icon.png" width="128" alt="Clawd icon">
</p>

<h1 align="center">Clawd Desktop Pet</h1>

<p align="center">A little 3D crab that lives on your macOS desktop — Clawd, the Claude Code mascot.<br>It wanders around, can be dragged and tossed, shows how much Claude Code quota you have left, and calls you when Claude finishes a task.</p>

<p align="center"><b>English</b> · <a href="README.zh-CN.md">简体中文</a></p>

<p align="center"><img src="docs/showcase.png" width="760" alt="Clawd in different states: quota bar overhead, reporting a finished task, talking to itself, being petted, looking cool, typing on a laptop with you, sleeping when quota runs out, Halloween outfit"></p>

> **Note:** Clawd's own interface (menus, speech bubbles, usage panel) is currently in **Simplified Chinese** only. Menu names in this README are given in English with the original Chinese in brackets so you can find them.

---

## Features

**Everyday life**
- Strolls along the bottom of the screen on its own: walks sideways, looks around, hops now and then, waves
- Its eyes follow your mouse; when the cursor rests on it, it stops and looks at you
- Blinks at random, sometimes twice in a row or with just one eye (a wink)
- Talks to itself when idle (in a "thought" bubble), depending on the time of day, your quota, whether it's clinging to the screen edge, and how hard you've been using Claude Code

**Interaction**
- **Click**: raises both arms and pops up the usage panel above its head; click again while the panel is open to close it, and it hops
- **Drag**: looks startled when picked up, arms and legs flailing; let go and it falls — toss it hard and it bounces and gets dizzy for a moment
- **Pet it**: rest the cursor on it without moving and it shows heart eyes and blushes; poke it 4 times quickly and it gets annoyed

**Stays out of your way**
- Clicks anywhere except on Clawd itself pass straight through
- When the cursor merely passes over Clawd, it turns semi-transparent and clicks pass through to the app underneath; it becomes solid (clickable and draggable) only after the cursor rests on it for about 0.35 s — and it stops to look at you
- If you keep working with the cursor near it, it walks away to give you room
- Its window never takes focus: clicking or dragging it never steals the keyboard, so typing always goes to your current app
- The menu has **Full click-through (look, don't touch)** ("完全穿透（只看不点）"): Clawd ignores the mouse entirely and you interact through the menu only

**Always there, easy to tuck away**
- Clawd has icons in both the menu bar and the Dock (if you'd rather not use a Dock slot, turn the Dock icon off under **Settings**; Clawd stays on the desktop and the menu lives in the menu bar icon)
  - Left-click the menu bar icon: hide / show Clawd
  - Click the Dock icon: brings Clawd back if hidden, otherwise it hops
  - Right-click either icon for the full menu:
    - Hide / show Clawd, View usage
    - **Actions** (动作): hop, wave, dance, peek around, take a walk, stretch
    - **Position** (位置): cling to the screen edge / leave the edge, back to the center of the screen
    - **Claude Code**: connect Claude Code (task alerts), alert when a reply is done, alert when it needs approval / is waiting for you
    - **Appearance** (外观): size, quota bar, holiday outfits
    - **Settings** (设置): self-talk (chatty / normal / quiet / silent), break reminder (off / 45 / 60 / 90 min), free roaming, full click-through, show icon in Dock, launch at login
    - Quit Clawd (in the menu bar icon's menu)
- When hidden, Clawd jumps, spins and shrinks away; when shown, it drops in from the top of the screen. While hidden it uses no CPU / GPU

## Claude Code usage

<p align="center"><img src="docs/usage-panel.png" width="296" alt="Pixel-style usage panel (sample data)"></p>

Click Clawd or choose **View usage** (查看用量) in the menu, and a pixel-style usage panel pops up above its head (the image above uses sample data):

| What | Where it comes from |
|---|---|
| Remaining % and reset time of the 5-hour and weekly quotas | Runs the official `claude -p "/usage"` command — the same numbers as `/usage` inside Claude Code |
| Cost and token counts for today, the last 7 days and the current 5-hour window, plus per-model share | Reads local session logs under `~/.claude/projects/` and estimates cost at Anthropic API prices |

- The quota check only reads your quota: it **does not call a model, use any quota, or leave a session behind**. Clawd itself **never reads any login credentials**
- Quota is checked once at launch and every 5 minutes after; opening the panel also refreshes it if the data is more than a minute old
- Cost is an **estimate** at API prices. On a subscription plan you are not billed this way — treat it as a rough "how much have I used" figure
- Subscription quotas exist only on Pro / Max plans; with an API key, only the cost estimate is shown

**Clawd's mood follows your remaining quota** (whichever of the 5-hour and weekly quotas is lower):

| Remaining | Mood | What you'll see |
|---|---|---|
| ≥ 50% | Full of energy | Normal activity |
| 20% – 50% | A bit busy | Occasionally sweats, sometimes flops down for a rest |
| 10% – 20% | Tired | Half-closed eyes, walks slowly, naps often |
| < 10% | Running on empty | Body color dims, trembles slightly, sweats a lot; reminds you every 15 minutes |
| Used up | Out of quota | Cries for a moment, then puts on a nightcap and sleeps, body turns grey |

When the mood gets worse, Clawd says something about it; when the quota resets, it dances to celebrate. Without quota data (for example with an API key), it uses the estimated cost of the current 5-hour window for the first three moods ($8 / $25). The thresholds are the `LEVEL_*` constants in [`clawd-pet/pet.js`](clawd-pet/pet.js).

### Quota bar

A bar floats above Clawd: the 10 cells show the **5-hour quota**, and the small ring next to it shows the **weekly quota**. Colors follow the five moods above (terre verte → yellow ochre → burnt sienna → alizarin → grey). Below 20% the 5-hour percentage is shown, and below 10% it blinks; hover over Clawd to see both percentages. When Clawd clings to the screen edge, the bar turns vertical and hangs beside it.

Under **Appearance → Quota bar** (外观 → 血条) you can choose **Always show** (default) / **Show on hover** / **Off**.

## Working with Claude Code

Tick **Claude Code → Connect Claude Code (task alerts)** (连接 Claude Code（任务提醒）) in the menu and Clawd adds a few hooks to `~/.claude/settings.json`. It only appends its own entries and leaves your existing hooks untouched; the original file is backed up as `settings.json.clawd-backup`, and unticking removes those entries again. In **newly started** Claude Code sessions:

- **Claude is working**: Clawd pulls out a little laptop and works along with you, and its self-talk says what Claude is doing, e.g. "Claude is running a command: npm test…"
- **A reply is done** (only for tasks that took 15 seconds or more): Clawd jumps and reports "Claude is done ✅", with the project name
- **Claude needs your approval / is waiting for your reply / has a question for you**: Clawd waves, e.g. "🙋 Wants to use Bash — needs your approval"
- **A tool call fails**: Clawd goes `x x` for a moment (no bubble — small failures like a search with no results are common)
- **Claude stops with an error**: Clawd cries and tells you "⚠️ Claude stopped with an error"

**Session list**: the bottom of the usage panel lists your recent Claude Code sessions (up to 5). Each row shows the project name, its current state (💭 thinking / ⚙️ running a command: npm test / ⚙️ editing: App.tsx / 🙋 needs approval / 💬 waiting for you / ✅ done / ⚠️ error) and how long it has been going, updated every second while the panel is open.

All hooks run in the background (`async`), so they never slow Claude Code down. They use `curl` to send events to `127.0.0.1:47615` on your machine; if Clawd isn't running, the command exits silently right away. Each kind of alert can be turned off in the same menu. If you connected an older version of Clawd, it adds the new hooks automatically on launch.

### Quota forecast and break reminders

- Clawd records the 5-hour quota every time it checks and predicts, from the recent rate, how long you have left. The usage panel shows "at this pace, used up in about 40 min" or "will last until the reset", and Clawd warns you once if it expects the quota to run out within 45 minutes
- After you've used Claude Code continuously for the set time (60 minutes by default), Clawd stretches and reminds you to get up and move; a 10-minute break resets the timer

## Expressions, props and looks

- **Expressions**: blinks and follows the cursor, squints when tired. It also has `> <`, `^ ^`, `x x`, `o o`, sunglasses, heart eyes with blush, star eyes, `$ $`, annoyed, crying and winking, each for its own moment — startled when picked up, dizzy after a hard fall, heart eyes when petted, annoyed after 4 quick pokes
- **Props**: a nightcap for sleeping, a party hat for celebrating, sometimes headphones while dancing, a little laptop while you're using Claude Code, and a cup of coffee in the morning
- **Self-talk**: every so often it says something, depending on the time, your quota, whether it's clinging to the edge and how hard you've been using Claude Code; adjust how often under **Settings → Self-talk** (设置 → 自言自语): chatty / normal / quiet / silent
- **Pixel-style bubbles**: things it says to you appear in a pixel-bordered dialog box with a stepped tail; self-talk uses a "thought" bubble with two little pixel squares underneath. Bubbles pop in and the text types out letter by letter, in the Ark Pixel font
- **Holiday outfits**: a witch hat for Halloween, a Santa hat for Christmas, a red scarf for Lunar New Year (turn off under **Appearance → Holiday outfits**, 外观 → 节日装扮)
- **Size**: small / medium / large / extra large under **Appearance → Size** (外观 → 大小)

All menu settings are remembered in `~/Library/Application Support/Clawd/settings.json`.

## Edge-cling mode

Drag Clawd to the left or right edge of the screen and let go (or fling it at the edge, or choose **Cling to the screen edge** in the menu). It turns sideways and hangs on the edge with most of its body off-screen, just peeking out — no walking, nothing blocked. It leans out a little more when the cursor comes near; click it to see usage as usual. Drag it away from the edge (or choose **Leave the edge**) to return to normal.

## Install and run

Requires macOS (Apple silicon), Node.js, and the [Claude Code](https://code.claude.com) CLI, signed in (used to check your quota).

```bash
cd clawd-pet
npm install
npm start            # run in development mode
```

Package as `Clawd.app` and install it into Applications:

```bash
cd clawd-pet
npm run package && ditto dist/Clawd-darwin-arm64/Clawd.app /Applications/Clawd.app
```

Quit the running Clawd from its menu before updating. Once it's in Applications, you can tick **Launch at login** in the menu.

> The app is not signed. It runs fine on your own Mac; if you send it to someone else, they need to right-click it and choose **Open** the first time.

### Development switches

These only take effect with `npm start` (unpackaged):

```bash
CLAWD_SELFTEST=1 npm start       # hide after 4 s, show again after 8 s
CLAWD_SELFTEST=usage npm start   # pop up the usage panel after 3 s
CLAWD_SELFTEST=cling npm start   # cling to the screen edge after 3 s
CLAWD_FAKE_QUOTA=7 npm start     # pretend only 7% of the 5-hour quota is left, to see each mood
CLAWD_FAKE_WEEK=30 npm start     # pretend only 30% of the weekly quota is left, to see the ring
CLAWD_FAKE_QUOTA=30 CLAWD_FAKE_ETA=25 npm start   # pretend the quota runs out in 25 min at this pace
CLAWD_HOOK_PORT=47616 npm start  # use another port for the hooks endpoint (while the installed Clawd is running)
CLAWD_CC_SETTINGS=/tmp/s.json npm start           # "Connect Claude Code" edits this file instead of your real settings
CLAWD_DEMO=1 npm start           # use fixed sample data (for README screenshots, without exposing real usage)
```

Check the usage statistics on their own:

```bash
cd clawd-pet && node usage.js
```

## Where the design and motion come from

- **Look**: based on Clawd's quadrant-block ASCII art in the Claude Code program, the official Anthropic Clawd animations (short videos posted by [@claudeai](https://x.com/claudeai)), and the 3D-printed Clawd: a square, sturdy body, flat arms on each side, four block legs (with a wider gap between the middle two), and small square eyes. The legs are a bit longer than the reference so it moves more lively
- **Legs**: each leg is a hip-to-foot column; feet stay planted once they touch the ground. When peeking, the body leans forward and rises while the four legs slant like a parallelogram; when walking, the two pairs of feet step alternately; in the air the legs dangle under the body with limited stretch
- **Other motion**: everything is eased with damped springs, with anticipation, squash and stretch, and a bounce on landing; before a jump it crouches quickly and pushes its arms down — inspired by [Codrops' frame-by-frame breakdown of the official animations](https://tympanus.net/codrops/2026/05/05/reverse-engineering-claude-ais-mascot-animations-with-svg-and-gsap/)

## Project structure

```
clawd/
├── clawd-pet/                 the desktop pet (Electron + three.js)
│   ├── main.js                main process: transparent always-on-top window, click-through, menu bar / Dock, usage scheduling, Claude Code hooks
│   ├── preload.js             bridge between the main process and the page
│   ├── index.html             page and styles for the pixel dialog boxes / usage panel / quota bar
│   ├── pet.js                 3D model, motion, physics, interaction, moods
│   ├── usage.js               local usage statistics + subscription quota check
│   ├── trayTemplate*.png      menu bar icons
│   ├── fonts/                 pixel font (Ark Pixel Font 12px, Simplified Chinese, + OFL license)
│   └── build/                 app icon (Blender render script + compositing script)
├── clawd.html                 web version of the 3D Clawd (open directly in a browser)
├── claude_figure.*            the very first Blender figure (not Clawd's shape — kept as a keepsake)
├── README.md                  English README
├── README.zh-CN.md            Chinese README
└── docs/                      images for the README (captured with CLAWD_DEMO=1 sample data)
```

Regenerate the app icon (needs Blender and Pillow):

```bash
cd clawd-pet
/Applications/Blender.app/Contents/MacOS/Blender -b -P build/render_icon.py
python3 build/make_icon.py
```

## Notes

Clawd is Anthropic's mascot. This is a personal hobby project, not affiliated with Anthropic, for personal use only.

Text in the bubbles, usage panel and quota bar uses the [Ark Pixel Font](https://github.com/TakWolf/ark-pixel-font) 12px Simplified Chinese edition, © TakWolf, licensed under the [SIL Open Font License 1.1](clawd-pet/fonts/ark-pixel-OFL.txt).
