// Clawd 桌宠 —— 渲染进程入口
// 比例和动作参考 Anthropic 官方 Clawd 动画(@claudeai 发布的短片,以及 Codrops 上对它的逐帧拆解):
//   · 四条细腿较长(约为身体高度的一半),每边两条挨着,中间留空;
//   · 眼睛是小方块;两侧短手臂大约和眼睛同高;
//   · 张望时身体前倾、抬高、微转,脚钉在地上不动,腿被拉长、整体斜过去;
//   · 起跳前快速下蹲、手往下压;落地手会往下"弹"一下再回来。
// 腿用"髋 → 脚"两点直接连成一根柱子:脚落地时就固定在地面上,身体怎么动腿都跟着拉伸、倾斜。
//
// 代码按功能分在 renderer/ 下(没有构建步骤,浏览器直接按 ES 模块加载):
//   i18n      界面语言和格式化          util / state  小工具、几个模块共用的状态和菜单设置
//   scene     画布、相机、灯光          model         3D 模型、表情、道具、节日装扮
//   anchor    Clawd 在屏幕上的位置      world         屏幕大小、位置速度、脚、光标
//   animation 每一帧的动作和物理        behavior      挑下一个动作、贴边
//   loop      主循环和省电降帧          input         光标、拖拽、点击、防挡
//   bubble    头顶气泡                  hud           头顶血条
//   quota     用量、额度和心情          chatter       自言自语
//   sessions  Claude Code 会话状态      crabs         头顶小螃蟹和会话详情
//   perm      批准权限、回答选择题      reactions     对测试 / push / rm -rf 等的反应
//   fx        像素小特效                reminders     日报、离开小结、催批准、休息提醒
//   sfx       音效                      commands      主进程发来的命令
// 下面这些模块加载时会注册 IPC / DOM 事件和定时器;其余的被它们按需引入
import './renderer/quota.js';
import './renderer/sessions.js';
import './renderer/crabs.js';
import './renderer/perm.js';
import './renderer/reminders.js';
import './renderer/commands.js';
import './renderer/input.js';
import { startLoop } from './renderer/loop.js';

startLoop();
