// 在 Clawd 上批准权限、回答 Claude 的选择题
import { state } from './state.js';
import { esc, t } from './i18n.js';
import { sfx } from './sfx.js';
import { bubble, bubbleKind, hideBubble, say, sayLater } from './bubble.js';
import { ccSessions } from './sessions.js';
import { jumpSession } from './crabs.js';
import { action, isClinging, setAction } from './behavior.js';

// ---------------- 在 Clawd 上批准权限 ----------------
// Claude 要你批准、而它所在的终端不在最前面时,Clawd 弹出「允许 / 拒绝 / 去终端处理」。一次只问一个,其他的排队;
// 60 秒没点(主进程计时)就交回终端照常弹框
export const permQueue = [];   // { id, project, tool, preview, app, tty, host }
   // bubbleHover:光标在批准气泡 / 用量面板上
function showPerm() {
  if (state.permShown || !permQueue.length || state.paused) return;
  const p = state.permShown = permQueue[0];
  if (bubbleKind === 'usage') hideBubble();
  showPermBubble(p);
  sfx('ask');
  if (!isClinging() && !['drag', 'leave'].includes(action.type)) setAction({ type: 'wave', dur: 2.4 });
}
function showPermBubble(p) {
  const name = esc(p.title || p.project || t('会话'));
  say((p.questions ? questionHtml(p, name)
    : t('🙋 <b>{0}</b> 要用 <b>{1}</b>', name, esc(p.tool)) + (p.preview ? `<code>${esc(p.preview)}</code>` : '')
      + `<div class="btns"><button data-d="allow">${t('允许')}<small>⌥⌘Y</small></button><button data-d="deny">${t('拒绝')}<small>⌥⌘N</small></button><button data-d="pass">${t('去终端处理')}</button></div>`
      // 总是允许:下面一行写着放行的规则和记在哪;最下面可以写一句原因再拒绝,Claude 会看到
      + (p.always ? `<button class="always" data-d="always">${t('总是允许')}<small>${esc(p.always)}</small></button>` : '')
      + `<input class="other why" placeholder="${esc(t('写一句原因再拒绝…'))}" spellcheck="false">`)
    + (permQueue.length > 1 ? `<i class="more">${t('后面还有 {0} 个', permQueue.length - 1)}</i>` : ''), 3600, 'perm');
  bubble.classList.add('say');   // 外观和对你说话的气泡一样
}
// Claude 出的选择题(AskUserQuestion):一次一题,点选项就答;多选题点几个再按「确定」;最下面可以自己写
function questionHtml(p, name) {
  p.qi ??= 0; p.answers ??= {}; p.picked = new Set();
  const q = p.questions[p.qi], n = p.questions.length;
  return t('🙋 <b>{0}</b> 问你', name) + (n > 1 ? ` <i class="qn">${p.qi + 1}/${n}</i>` : '')
    + `<div class="q">${esc(q.question)}</div><div class="opts">`
    + q.options.map((o, i) => `<button data-o="${i}">${i + 1}. ${esc(o.label)}${o.description ? `<small>${esc(o.description)}</small>` : ''}</button>`).join('')
    + `<input class="other" placeholder="${esc(t('其他，自己写…'))}" spellcheck="false"></div>`
    + `<div class="btns">${q.multi ? `<button data-d="ok">${t('确定')}</button>` : ''}<button data-d="pass">${t('去终端处理')}</button></div>`;
}
function answerQuestion(v) {
  const p = state.permShown;
  p.answers[p.questions[p.qi].question] = v;
  if (++p.qi < p.questions.length) { stopTyping(); showPermBubble(p); sfx('pop'); return; }
  window.pet?.permDecision(p.id, 'allow', p.answers);
  sfx('pop');
  dropPerm(p.id);
}
function pickedAnswer() {   // 多选题:选中的选项加上自己写的,用逗号连起来
  const p = state.permShown, q = p.questions[p.qi], other = bubble.querySelector('.other')?.value.trim();
  return [...q.options.filter((_, i) => p.picked.has(i)).map(o => o.label), ...(other ? [other] : [])].join(', ');
}
let typing = false;
function stopTyping() { if (typing) { typing = false; window.pet?.permTyping(false); } }
bubble.addEventListener('pointerdown', e => {   // 窗口平时拿不到键盘:点输入框时才临时要过来
  const el = e.target.closest('.other');
  if (!el || typing) return;
  typing = true; window.pet?.permTyping(true);
  setTimeout(() => el.focus(), 50);
});
bubble.addEventListener('focusout', e => { if (e.target.matches('.other')) stopTyping(); });
bubble.addEventListener('keydown', e => {
  if (!e.target.matches('.other')) return;
  if (e.key === 'Escape') e.target.blur();
  if (e.key !== 'Enter' || e.isComposing) return;   // 输入法选字时的回车不算
  const p = state.permShown;
  if (!p.questions) { const why = e.target.value.trim(); if (why) decidePerm('deny', why); return; }   // 批准气泡:写了原因就拒绝
  const v = p.questions[p.qi].multi ? pickedAnswer() : e.target.value.trim();
  if (v) answerQuestion(v);
});
export function dropPerm(id) {
  const i = permQueue.findIndex(p => p.id === id);
  if (i < 0) return;
  permQueue.splice(i, 1);
  if (state.permShown?.id === id) { state.permShown = null; state.bubbleHover = false; stopTyping(); hideBubble(true); }
  showPerm();
  if (!state.permShown && sayLater.length && !state.paused) {   // 都处理完了:把攒着的话合成一个框说出来
    for (const s of sayLater.splice(0)) say(s.html, s.secs);
    if (!isClinging() && !['drag', 'leave'].includes(action.type)) setAction({ type: 'wave', dur: 1.6 });
  }
}
window.pet?.onPerm?.(p => { permQueue.push(p); showPerm(); if (state.permShown && state.permShown !== p) showPermCount(); });
function showPermCount() {   // 排队的数量变了:更新「后面还有 N 个」
  const el = bubble.querySelector('.more'), n = permQueue.length - 1;
  if (el) el.textContent = t('后面还有 {0} 个', n);
  else if (n > 0) bubble.insertAdjacentHTML('beforeend', `<i class="more">${t('后面还有 {0} 个', n)}</i>`);
}
bubble.addEventListener('click', e => {
  const row = e.target.closest('.sess[data-sid]');   // 用量面板里的会话
  if (row) { const s = ccSessions.get(row.dataset.sid); if (s && !jumpSession(s)) say(t('这个会话开得早，还不知道它在哪个窗口<br>重新打开会话后就能跳过去了'), 4); return; }
  const o = e.target.closest('button[data-o]');
  if (o && state.permShown?.questions) {
    const p = state.permShown, i = Number(o.dataset.o);
    if (!p.questions[p.qi].multi) return answerQuestion(p.questions[p.qi].options[i].label);
    p.picked.has(i) ? p.picked.delete(i) : p.picked.add(i);
    o.classList.toggle('on', p.picked.has(i));
    return sfx('poke');
  }
  const b = e.target.closest('button[data-d]');
  if (b?.dataset.d === 'ok') { const v = pickedAnswer(); return v && answerQuestion(v); }
  if (b) decidePerm(b.dataset.d);
});
export function decidePerm(d, why) {   // 点按钮或按快捷键;why:拒绝的原因
  if (!state.permShown || (state.permShown.questions && d !== 'pass')) return;   // 选择题没有「允许 / 拒绝」,⌥⌘Y / ⌥⌘N 不管用
  const p = state.permShown;
  window.pet?.permDecision(p.id, d, null, why);
  sfx(d === 'allow' || d === 'always' ? 'pop' : 'poke');
  if (d === 'pass' && p.app) window.pet?.focusSession({ app: p.app, tty: p.tty, host: p.host });   // 去终端处理:顺便跳过去
  dropPerm(p.id);
}
