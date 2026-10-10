// 代码检查:只开 eslint 推荐规则里能抓 bug 的那些,不管代码风格(现有代码风格很紧凑,保持原样)
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/', 'dist/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {   // 渲染进程:pet.js 和 renderer/ 下的 ES module,跑在浏览器里
    files: ['pet.js', 'renderer/**/*.js'],
    languageOptions: { sourceType: 'module', globals: { ...globals.browser } },
  },
  {   // 打包脚本:跑在 Node 里的 ES module
    files: ['**/*.mjs'],
    languageOptions: { sourceType: 'module' },
  },
];
