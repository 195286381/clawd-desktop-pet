// 几个模块都会改的运行状态 / 菜单设置。ES 模块导出的 let 在别的模块里是只读的,所以放进对象里共享

// 偏好:主进程按菜单设置通过命令发过来(见 commands.js)
export const prefs = {
  chatLevel: 'normal',
  breakMin: 60,
  ccNotify: { done: true, ask: true },
  ccHooks: false,   // hooks 连上了(收到过事件,或菜单里装好了)
  holidayOn: true,
  hpMode: 'always',   // 血条显示方式:always / hover / off
  wander: true,
  soundOn: false,
  crabsOn: true,   // 头顶的会话小螃蟹,菜单里可以关掉
  reportOn: true,
  passthrough: false,
  onBattery: false,
  powerSave: false,
};

// 运行状态
export const state = {
  paused: false,
  userAway: false,
  awayFrom: 0,   // 你最后一次动键盘鼠标的时间
  restedAt: 0,   // 上次休息完回来的时间
  hovering: false,
  interactive: false,
  press: null,   // 按在 Clawd 上(点或拖)
  canvasLeft: 0,   // 跟着 Clawd 走的小画布在屏幕上的位置
  canvasTop: 0,
  permShown: null,
  bubbleHover: false,   // 光标在批准气泡 / 用量面板上
  dotsHover: false,   // 光标在会话小螃蟹 / 会话详情上
  dotsSince: 0,
  dotsPicked: null,   // 光标指着的会话(螃蟹或详情里的一行)
  dizzyUntil: 0,   // 摔晕到什么时候
  sweatT: -1,   // 汗珠开始往下滑的时间(-1 = 没有)
  holidayForce: null,   // 开发自测:提前看节日装扮
  propOverride: null,   // 开发自测:临时拿某个道具
  propOverrideUntil: 0,
  dotsMouse: false,   // 光标真的在会话小螃蟹 / 会话详情上(用键盘挑会话时 dotsHover 也为真)
  // 一阵子的装扮(Date.now() 毫秒):push 后背火箭背包、测试连过挂金牌、连着失败撑伞、构建 / 装依赖拿扳手
  jetpackUntil: 0,
  medalUntil: 0,
  rainUntil: 0,
  wrenchUntil: 0,
};
