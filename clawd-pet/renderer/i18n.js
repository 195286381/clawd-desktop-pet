// 界面语言和格式化:t('中文') 翻译,金额 / token / 时间的显示格式
import EN from '../locales/en.json' with { type: 'json' };

// ---------------- 界面语言 ----------------
// 主进程按菜单设置通过 ?lang= 传进来。文案直接以中文原文为键:t('中文') 在英文界面下查 locales/en.json,
// 查不到就原样显示中文;{0} {1} 是占位符。
const LANG = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh';
const EN_UI = LANG === 'en';
export const t = (s, ...a) => ((EN_UI && EN[s]) || s).replace(/\{(\d)\}/g, (_, i) => a[i]);
export const tr = t;   // frame() 里的局部变量 t 是时间,会盖住 t(),那里用 tr 翻译
document.documentElement.lang = EN_UI ? 'en' : 'zh-CN';
export const fmtCost = c => '$' + (c >= 100 ? c.toFixed(0) : c.toFixed(2));
export function fmtTokens(n) {
  if (EN_UI) return n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'K' : String(n);
  if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
  if (n >= 1e4) return Math.round(n / 1e4) + ' 万';
  return String(n);
}
// 额度重置时间:"14:00 重置" / "明天 14:00 重置" / "周三 14:00 重置";back = true 时说"恢复"(额度用完时)
export function fmtReset(ms, back = false) {
  if (!ms) return '';
  const d = new Date(ms), now = new Date();
  const hm = d.toTimeString().slice(0, 5);
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 864e5);
  if (EN_UI) {
    const when = days === 0 ? hm : days === 1 ? `tomorrow ${hm}` : `${'Sun Mon Tue Wed Thu Fri Sat'.split(' ')[d.getDay()]} ${hm}`;
    return (back ? 'back ' : 'resets ') + when;
  }
  const when = days === 0 ? hm : days === 1 ? `明天 ${hm}` : `周${'日一二三四五六'[d.getDay()]} ${hm}`;
  return `${when} ${back ? '恢复' : '重置'}`;
}
export function fmtAgo(min) {
  if (min < 60) return EN_UI ? `${min} min` : `${min} 分钟`;
  if (min < 1440) return EN_UI ? `${Math.round(min / 60)} h` : `${Math.round(min / 60)} 小时`;
  return EN_UI ? `${Math.round(min / 1440)} d` : `${Math.round(min / 1440)} 天`;
}
export const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function fmtElapsed(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (EN_UI) return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m`;
  return s < 60 ? `${s} 秒` : s < 3600 ? `${Math.floor(s / 60)} 分 ${s % 60} 秒` : `${Math.floor(s / 3600)} 小时 ${Math.floor(s % 3600 / 60)} 分`;
}
export function fmtMin(m) {
  if (EN_UI) return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`;
  return m >= 60 ? `${Math.floor(m / 60)} 小时${m % 60 ? ' ' + (m % 60) + ' 分' : ''}` : `${m} 分钟`;
}
