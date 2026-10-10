// 音效(默认关,菜单「设置 → 音效」打开)
import { prefs } from './state.js';

// ---------------- 音效(默认关,菜单「设置 → 音效」打开) ----------------
// 不用音频文件:用 Web Audio 现场合成 8-bit 风格的小音效(方波 / 三角波),音量压得很低。
// 每个音效是一串音符 [频率 Hz(0 = 停顿), 时长秒, 波形, 滑到的频率]。
let actx = null;
const SFX_VOL = 0.05;
const SFX = {
  jump: [[330, 0.12, 'square', 700]],
  land: [[160, 0.07, 'triangle', 80]],
  bonk: [[220, 0.06, 'square', 110], [0, 0.03], [180, 0.1, 'square', 90]],
  pickup: [[500, 0.07, 'square', 900]],
  poke: [[620, 0.05, 'square', 310]],
  pop: [[660, 0.05, 'triangle', 990]],
  purr: [[200, 0.18, 'triangle', 240], [240, 0.18, 'triangle', 200]],
  done: [[523, 0.08], [659, 0.08], [784, 0.08], [1047, 0.2]],          // 叮咚上行:做完啦
  ask: [[880, 0.08], [0, 0.06], [880, 0.14]],                          // 叮、叮:需要你
  error: [[392, 0.12], [311, 0.12], [247, 0.24]],                      // 下行三音:出错
  low: [[440, 0.12, 'triangle'], [330, 0.2, 'triangle']],
  recover: [[523, 0.07], [784, 0.07], [1047, 0.16]],
  chime: [[784, 0.1, 'triangle'], [1047, 0.22, 'triangle']],           // 休息提醒、额度预测
  leave: [[400, 0.18, 'square', 1400]],
};
export function sfx(name) {
  if (!prefs.soundOn || !SFX[name]) return;
  try {
    actx ||= new AudioContext();
    if (actx.state === 'suspended') actx.resume();
    let t = actx.currentTime + 0.02;
    for (const [f, dur, type = 'square', to] of SFX[name]) {
      if (f) {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f, t);
        if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(SFX_VOL * (type === 'triangle' ? 2 : 1), t + 0.01);   // 三角波听着轻,补一点
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(actx.destination);
        o.start(t); o.stop(t + dur + 0.02);
      }
      t += dur;
    }
  } catch (e) { console.warn('音效播放失败', e); }
}
