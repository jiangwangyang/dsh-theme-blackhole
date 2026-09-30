/**
 * dsh-theme-blackhole — 黑洞主题插件（Host 半边）
 *
 * 本插件无开关：加载即启用，卸载即还原。用户经插件管理（禁用/卸载）
 * 关闭主题，不占用设置界面的任何开关行。
 *
 * 职责：
 *   1. 通过 webServer 服务 /blackhole/* 静态资源（按请求读盘，改动后刷新即生效）：
 *      /blackhole/blackhole.css  结构层样式（画布层、#root 毛玻璃、shiki 令牌；
 *      --dsw-* 调色板已由客户端半边经 ctx.theme.overrideTokens 进入令牌覆盖层）
 *      /blackhole/blackhole.js   史瓦西黑洞 WebGL 渲染器（window.DshBlackhole 控制器）
 *   2. tapIndex 首屏引导：无条件向 index.html 注入激活标记、样式表与渲染器，
 *      避免客户端插件加载前闪默认主题。
 *
 * 配色经 ui-theme 的令牌覆盖层（overrideTokens）生效，与 light/dark/system
 * 偏好通道正交：不注册主题 id、不读写主题偏好，卸载时覆盖层随纤维回收自动还原。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Stable Cordis plugin name. */
export const name = 'theme-blackhole'

/** 本插件对外服务的静态资源表：URL 路径 → 相对文件名与 MIME 类型。 */
const ASSETS = {
  '/blackhole/blackhole.js': { file: 'blackhole.js', type: 'text/javascript; charset=utf-8' },
  '/blackhole/blackhole.css': { file: 'blackhole.css', type: 'text/css; charset=utf-8' },
}

/** 资源目录（本文件位于 src/，资源位于 ../assets/）。 */
const ASSET_DIR = fileURLToPath(new URL('../assets/', import.meta.url))

/**
 * 首屏引导注入（无条件）：在 </head> 之前写入 html 激活标记（让
 * blackhole.css 的门控选择器立即生效）、样式表 link（携带同名标记，客户端
 * 半边激活时认领而非重复插入）与 defer 的渲染器脚本（仅定义控制器，不自动启动）。
 * @param {string} html - 原始 index HTML。
 * @returns {string} 注入资源标签后的 HTML。
 */
function injectBootAssets(html) {
  const tags = '<script>document.documentElement.setAttribute("data-dsh-blackhole", "")</script>'
    + '<link rel="stylesheet" href="/blackhole/blackhole.css" data-dsh-blackhole="">'
    + '<script defer src="/blackhole/blackhole.js"></script>'
  const close = html.search(/<\/head>/i)
  if (close === -1) return `${html}${tags}`
  return `${html.slice(0, close)}${tags}${html.slice(close)}`
}

/**
 * 服务一个 /blackhole/* 静态资源请求；非 GET/HEAD 405，未知路径 404，
 * 读盘失败 404。资源按请求读盘，改动后浏览器刷新即生效。
 * @param {import('node:http').IncomingMessage} req - 请求对象。
 * @param {import('node:http').ServerResponse} res - 响应对象。
 */
async function serveAsset(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405)
    res.end()
    return
  }
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  const asset = ASSETS[pathname]
  if (asset === undefined) {
    res.writeHead(404)
    res.end()
    return
  }
  try {
    const body = await readFile(join(ASSET_DIR, asset.file))
    res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-cache' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
}

/**
 * 挂载黑洞主题 Host 半边：注册 /blackhole 前缀路由并无条件向 index.html
 * 注入首屏引导。等待 webServer 服务就绪后生效，插件卸载时自动回收。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host 插件上下文。
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(
      () => httpCtx.webServer.register({ kind: 'prefix', path: '/blackhole', handler: serveAsset }),
      'theme-blackhole: asset route',
    )
    httpCtx.effect(
      () => httpCtx.webServer.tapIndex(injectBootAssets),
      'theme-blackhole: boot injection',
    )
  })
  console.log('[theme-blackhole] loaded — 黑洞主题已启用（禁用/卸载插件即还原）')
}
