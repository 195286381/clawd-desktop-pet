// 对 Claude 干的活做出反应(测试、push、rm -rf …)
import { state } from './state.js';
import { S, clock } from './scene.js';
import { flashFace } from './model.js';
import { petAnchor } from './anchor.js';
import { Hpx, st } from './world.js';
import { sfx } from './sfx.js';
import { boxes, bubbles, confetti, smoke, sparkles } from './fx.js';
import { action, isClinging, setAction } from './behavior.js';

// ---------------- 对 Claude 干的活做出反应 ----------------
// 测试全过:蹦起来撒彩纸;没过:垂头丧气;git push 成功:像火箭一样蹿起来,脚底冒烟;rm -rf:吓得缩成一团发抖
// 强制推送:比 rm -rf 更紧张;git commit:盖章;装依赖:头顶落下一堆箱子;构建:成功闪星星、失败垂头丧气;docker:冒蓝泡泡;sudo:皱眉
// 测试全过 / push 有时来个后空翻;push 背上火箭背包;测试连过 3 次挂金牌;测试 / 构建连着失败 2 次头顶下雨、撑伞,下次通过就放晴
// 顺序有讲究:先匹配到的优先(强制推送要排在 push 前,sudo 排最后)
const CMD_KINDS = [
  ['rm', /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-[rR]\s+-f|-f\s+-[rR])\b/],
  ['force', /\bgit\b[^;&|]*\spush\b[^;&|]*(\s--force(?!-with)\b|\s-[a-zA-Z]*f[a-zA-Z]*\b|\s\+\S)/],
  ['push', /\bgit\b[^;&|]*\spush\b/],
  ['commit', /\bgit\b[^;&|]*\scommit\b/],
  ['test', /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(pytest|jest|vitest|rspec|phpunit|mocha)\b|\b(go|cargo|swift|mix|dotnet|deno)\s+test\b|\bmake\s+(test|check)\b/],
  ['build', /\b(npm|pnpm|yarn|bun)\s+(run\s+)?build\b|\b(cargo|go|swift|dotnet|gradle|mvn)\s+build\b|\bxcodebuild\b|\btsc\b|\bmake\b(?!\s+(test|check))/],
  ['install', /\b(npm|pnpm|yarn|bun)\s+(install|i|add|ci)\b|\bpip3?\s+install\b|\bbrew\s+install\b|\bcargo\s+(add|install)\b|\bgo\s+(get|mod\s+download)\b|\bbundle\s+install\b/],
  ['docker', /\bdocker(-compose|\s+compose)?\s+(build|run|up|compose)\b/],
  ['sudo', /(^|[;&|]\s*)sudo\b/],
];
export const cmdKind = c => (c && (CMD_KINDS.find(([, re]) => re.test(c)) || [])[0]) || '';
const reactAt = {};
let passStreak = 0, failStreak = 0;
const RAIN_MAX = 2 * 60e3, MEDAL_FOR = 90e3;
function tally(kind) {   // 连过 / 连挂的次数:节流和 Clawd 在不在场都要算
  const now = Date.now();
  if (kind === 'test-pass' || kind === 'build-pass') {
    failStreak = 0; state.rainUntil = 0;
    if (kind === 'test-pass' && ++passStreak >= 3) state.medalUntil = now + MEDAL_FOR;
  } else if (kind === 'test-fail' || kind === 'build-fail') {
    if (kind === 'test-fail') passStreak = 0;
    if (++failStreak >= 2) state.rainUntil = now + RAIN_MAX;
  }
  if (kind === 'install' || kind === 'build-pass' || kind === 'build-fail') state.wrenchUntil = now + 4e3;
}
const flip = () => Math.random() < 0.35;
export function react(kind) {
  const now = Date.now();
  tally(kind);
  if (now - (reactAt[kind] || 0) < 15e3) return;   // 好几个会话一起跑测试时别刷屏
  if (state.paused || state.userAway || state.permShown || isClinging() || ['drag', 'leave', 'fall', 'sleep'].includes(action.type)) return;
  reactAt[kind] = now;
  const an = petAnchor();
  if (kind === 'test-pass') { setAction({ type: 'jump', dir: 0, big: true, flip: flip() }); flashFace('star', 2); sfx('recover'); confetti(an.x, an.top); }
  else if (kind === 'test-fail') { setAction({ type: 'slump', dur: 2.4 }); flashFace('cry', 2.4); sfx('low'); }
  else if (kind === 'push') { setAction({ type: 'jump', dir: 0, big: true, flip: flip() }); state.jetpackUntil = now + 2.6e3; flashFace('joy', 1.6); sfx('leave'); smoke(an.x, Hpx - st.y * S); }
  else if (kind === 'rm') { setAction({ type: 'shiver', dur: 1.6 }); flashFace('surprised', 1.6); state.sweatT = clock.elapsedTime; }
  else if (kind === 'force') { setAction({ type: 'shiver', dur: 2.4 }); flashFace('dizzy', 2.4); state.sweatT = clock.elapsedTime; }
  else if (kind === 'commit') { setAction({ type: 'jump', dir: 0 }); flashFace('happy', 1.2); sfx('recover'); }
  else if (kind === 'install') { setAction({ type: 'slump', dur: 1.2 }); flashFace('surprised', 1.2); boxes(an.x, an.top); }
  else if (kind === 'build-pass') { setAction({ type: 'jump', dir: 0 }); flashFace('joy', 1.4); sfx('recover'); sparkles(an.x, an.top); }
  else if (kind === 'build-fail') { setAction({ type: 'slump', dur: 2.4 }); flashFace('cry', 2.4); sfx('low'); }
  else if (kind === 'docker') { setAction({ type: 'jump', dir: 0 }); flashFace('wink', 1.4); bubbles(an.x, an.top); }
  else if (kind === 'sudo') { setAction({ type: 'shiver', dur: 0.8 }); flashFace('annoyed', 1.6); }
  else if (kind === 'packed') { setAction({ type: 'jump', dir: 0 }); flashFace('happy', 1.4); sfx('recover'); }
}
