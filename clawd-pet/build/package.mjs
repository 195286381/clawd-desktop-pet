// 打包脚本:npm run package 用它。
// 没有签名用的环境变量时和以前一样,打出未签名的 App;
// 设置了 CLAWD_SIGN_IDENTITY 就用 Developer ID 签名,再设置公证凭据就顺便提交苹果公证并钉上票据(staple)。
//
//   CLAWD_SIGN_IDENTITY   钥匙串里证书的名字,如 "Developer ID Application: Zhiwei Zhu (ABCDE12345)"
//   公证二选一(推荐 API Key):
//     APPLE_API_KEY(.p8 文件路径) + APPLE_API_KEY_ID + APPLE_API_ISSUER
//     APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
import { packager } from '@electron/packager';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const identity = env.CLAWD_SIGN_IDENTITY;

function notarizeOpts() {
  if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID)
    return { appleApiKey: env.APPLE_API_KEY, appleApiKeyId: env.APPLE_API_KEY_ID, ...(env.APPLE_API_ISSUER ? { appleApiIssuer: env.APPLE_API_ISSUER } : {}) };
  if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID)
    return { appleId: env.APPLE_ID, appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD, teamId: env.APPLE_TEAM_ID };
  return null;
}

const opts = {
  dir: root,
  name: 'Clawd',
  platform: 'darwin',
  arch: 'arm64',
  icon: path.join(root, 'build/icon.icns'),
  appBundleId: 'local.clawd.pet',
  extendInfo: path.join(root, 'build/extend-info.plist'),
  out: path.join(root, 'dist'),
  overwrite: true,
  asar: true,
  ignore: [/^\/dist/, /^\/build\/(?!icon\.png)/, /^\/\.claude/],
};

if (identity) {
  opts.osxSign = {
    identity,
    // 签名失败就直接报错,别打出一个签了一半的包
    continueOnError: false,
    // 主程序用自己的权限清单(多了控制 iTerm / Terminal 要的 Apple Events);各个 Helper 沿用 Electron 默认的
    optionsForFile: file => path.basename(file) === 'Clawd.app'
      ? { hardenedRuntime: true, entitlements: path.join(root, 'build/entitlements.mac.plist') }
      : null,
  };
  const notarize = notarizeOpts();
  if (notarize) opts.osxNotarize = notarize;
  else console.warn('没有设置公证凭据:只签名,不公证。别的 Mac 打开时仍会被拦。');
} else if (env.CI) {
  console.warn('CI 里没有设置 CLAWD_SIGN_IDENTITY,打出的是未签名的 App。');
}

const [appDir] = await packager(opts);
console.log(`打包完成:${path.join(appDir, 'Clawd.app')}${identity ? (opts.osxNotarize ? '(已签名并公证)' : '(已签名,未公证)') : '(未签名)'}`);
