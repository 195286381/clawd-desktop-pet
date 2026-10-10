// 主进程发来的命令:菜单、偏好设置、开发自测
import { prefs, state } from './state.js';
import { S, canvas, clock } from './scene.js';
import { LEG_L, REST_X, flashFace, root } from './model.js';
import { Hpx, Wpx, feet, st } from './world.js';
import { sfx } from './sfx.js';
import { hideBubble, say, sayLater } from './bubble.js';
import { showUsage } from './quota.js';
import { chatter } from './chatter.js';
import { decidePerm, dropPerm, permQueue } from './perm.js';
import { BREAK_REST, awayLog, showReport, welcomeBack } from './reminders.js';
import { action, isClinging, pickWalk, setAction, stopCling } from './behavior.js';
import { startLoop, wake } from './loop.js';

window.pet?.onCommand(cmd => {
  wake();
  if (cmd === 'minimize') {
    if (state.press) { state.press = null; canvas.classList.remove('dragging'); }
    for (const p of permQueue.splice(0)) window.pet?.permDecision(p.id, 'pass');   // 收起了就没法点:全部交回终端
    state.permShown = null; sayLater.length = 0; hideBubble(true);
    setAction({ type: 'leave' });
    hideBubble();
    return;
  }
  if (cmd === 'restore') {
    // 从屏幕上方原来的位置掉下来
    state.paused = false;
    state.hovering = false; state.interactive = false;
    canvas.classList.remove('ghost');
    root.scale.setScalar(1); root.rotation.y = 0; root.rotation.z = 0;
    window.pet?.setClinging(false);
    st.y = Hpx / S + 1; st.vx = 0; st.vy = 0; st.air = true;
    feet.forEach((f, i) => { f.x = st.x + REST_X[i]; f.y = st.y - LEG_L; f.vx = f.vy = 0; f.swing = null; });
    setAction({ type: 'fall' });
    clock.getDelta();
    startLoop();
    return;
  }
  // 偏好设置:随时生效(拖着它的时候也不能丢)
  if (cmd.startsWith('chat:')) { prefs.chatLevel = cmd.slice(5); return; }
  if (cmd.startsWith('break:')) { prefs.breakMin = Number(cmd.slice(6)) || 0; return; }
  if (cmd.startsWith('holiday:')) { prefs.holidayOn = cmd.slice(8) !== 'off'; return; }
  if (cmd.startsWith('cc-notify:')) { prefs.ccNotify = { done: cmd[10] === '1', ask: cmd[11] === '1' }; return; }
  if (cmd.startsWith('cc-hooks:')) { prefs.ccHooks = cmd.slice(9) === 'on'; return; }
  if (cmd.startsWith('crabs:')) { prefs.crabsOn = cmd === 'crabs:on'; return; }
  if (cmd.startsWith('report:')) { prefs.reportOn = cmd === 'report:on'; return; }
  if (cmd.startsWith('show-report:')) { showReport(cmd === 'show-report:week'); return; }
  if (cmd.startsWith('hp:')) { prefs.hpMode = cmd.slice(3); return; }
  if (cmd.startsWith('power:')) { prefs.onBattery = cmd === 'power:battery'; return; }
  if (cmd.startsWith('power-save:')) { prefs.powerSave = cmd === 'power-save:on'; return; }
  if (cmd.startsWith('sound:')) { prefs.soundOn = cmd === 'sound:on'; return; }
  if (cmd.startsWith('fade:')) { canvas.dataset.fade = cmd.slice(5); return; }
  if (cmd.startsWith('away')) {
    state.userAway = true; awayLog.clear(); state.awayFrom = Number(cmd.slice(5)) || Date.now();
    if (!state.paused && !isClinging() && !['drag', 'leave', 'fall'].includes(action.type)) setAction({ type: 'sleep' });
    return;
  }
  if (cmd === 'back') {
    state.userAway = false;
    if (Date.now() - state.awayFrom >= BREAK_REST) state.restedAt = Date.now();   // 离开够久,算休息过了
    welcomeBack();
    return;
  }
  if (cmd.startsWith('perm-cancel:')) { dropPerm(Number(cmd.slice(12))); return; }
  if (cmd.startsWith('perm-key:')) { decidePerm(cmd.slice(9)); return; }
  if (action.type === 'drag' || action.type === 'leave') return;
  if (isClinging() && ['jump', 'wave', 'dance', 'lean', 'walk', 'home'].includes(cmd)) stopCling();
  if (cmd === 'passthrough-on') { prefs.passthrough = true; state.interactive = false; canvas.classList.remove('ghost'); return; }
  if (cmd === 'passthrough-off') { prefs.passthrough = false; return; }
  if (cmd === 'wander-on') { prefs.wander = true; return; }
  if (cmd === 'wander-off') { prefs.wander = false; if (!isClinging()) setAction({ type: 'rest', dur: 2 }); return; }   // 贴着墙就继续贴着,直接换动作会悬在半空
  if (cmd === 'home') { setAction({ type: 'walk', target: Wpx / S / 2 }); return; }
  if (cmd === 'walk') { setAction(pickWalk()); return; }
  if (cmd === 'cling') {
    if (isClinging()) { stopCling(); return; }
    // 往近的那边墙跳过去,撞上就贴住
    const side = st.x < Wpx / S / 2 ? -1 : 1;
    st.air = true; st.vx = side * 14; st.vy = 10;
    setAction({ type: 'fall', wantCling: true });
    return;
  }
  if (cmd === 'chat') { chatter(true); return; }
  if (cmd.startsWith('say:')) { say(cmd.slice(4), 4); return; }   // 开发自测:让它说一句
  if (cmd.startsWith('holiday-test:')) { state.holidayForce = cmd.slice(13) || null; return; }   // 开发自测:提前看节日装扮
  if (cmd === 'stretch') { if (!isClinging()) setAction({ type: 'stretch', dur: 3 }); return; }
  if (cmd.startsWith('sfx:')) { const was = prefs.soundOn; prefs.soundOn = true; sfx(cmd.slice(4)); prefs.soundOn = was; return; }   // 开发自测:试听
  if (cmd.startsWith('face:')) { flashFace(cmd.slice(5), 6); return; }
  if (cmd.startsWith('prop:')) { state.propOverride = cmd.slice(5); state.propOverrideUntil = clock.elapsedTime + 6; return; }
  if (cmd === 'usage') { showUsage(); if (!isClinging()) setAction({ type: 'present', dur: 2.4 }); return; }
  if (cmd === 'jump') setAction({ type: 'jump', dir: Math.random() < 0.5 ? -1 : 1 });
  if (cmd === 'wave') setAction({ type: 'wave', dur: 2.4 });
  if (cmd === 'dance') setAction({ type: 'dance', dur: 4 });
  if (cmd === 'lean') setAction({ type: 'lean', dir: Math.random() < 0.5 ? -1 : 1, dur: 1.8 });
});
