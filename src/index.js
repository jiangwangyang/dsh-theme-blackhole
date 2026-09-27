/**
 * dsh-theme-blackhole — 黑洞主题插件（Host 半边）
 *
 * 职责：
 *   1. 通过 webServer 服务 /blackhole/* 静态资源（按请求读盘，改动后刷新即生效）：
 *      /blackhole/blackhole.css  深空玻璃调色板（html[data-dsh-blackhole] 门控的 --dsw-* 覆写）
 *      /blackhole/blackhole.js   史瓦西黑洞 WebGL 渲染器（window.DshBlackhole 控制器）
 *   2. 以插件 Config schema 声明 enabled 开关（默认关）：dsh ≥ 0.1.7 的设置服务
 *      把活跃插件的 Config 投影成设置表单，客户端半边的 "主题-黑洞" 设置行经
 *      configForms 读写它；volatile 标记使写入原地生效，不重启插件。
 *   3. tapIndex 首屏引导：仅当开关为开时，向 index.html 注入激活标记、样式表
 *      与渲染器，避免客户端插件加载前闪默认主题；开关为关时不注入任何东西。
 *
 * 主题的注册、设置行与视觉生命周期全部由客户端半边（src/client/index.js）承担：
 * 黑洞主题 id 不进入 ui-theme 的内置设置 schema，这是 dsh 对第三方主题保留的边界。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'

/** Stable Cordis plugin name. */
export const name = 'theme-blackhole'

/** 开关配置：enabled 默认关；volatile 使设置写入原地更新，首屏注入在请求时读到实时值。 */
export const Config = z.object({
  enabled: z.boolean().default(false).volatile(),
})

/** 本插件对外服务的静态资源表：URL 路径 → 相对文件名与 MIME 类型。 */
const ASSETS = {
  '/blackhole/blackhole.js': { file: 'blackhole.js', type: 'text/javascript; charset=utf-8' },
  '/blackhole/blackhole.css': { file: 'blackhole.css', type: 'text/css; charset=utf-8' },
}

/** 资源目录（本文件位于 src/，资源位于 ../assets/）。 */
const ASSET_DIR = fileURLToPath(new URL('../assets/', import.meta.url))

/**
 * 首屏引导注入（仅开关为开时）：在 </head> 之前写入 html 激活标记（让
 * blackhole.css 的门控选择器立即生效）、样式表 link（携带同名标记，客户端
 * 半边激活时认领而非重复插入）与 defer 的渲染器脚本（仅定义控制器，不自动启动）。
 * @param {string} html - 原始 index HTML。
 * @param {boolean} enabled - 开关的当前值。
 * @returns {string} 注入资源标签后的 HTML。
 */
function injectBootAssets(html, enabled) {
  if (!enabled) return html
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
 * 挂载黑洞主题 Host 半边：声明设置表单策略（自带设置行，关闭自动表单页）、
 * /blackhole 前缀路由，并按开关当前值向 index.html 注入首屏引导。等待
 * settings/webServer 服务就绪后生效，插件卸载时自动回收。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host 插件上下文。
 * @param {{ enabled: { get: () => boolean } }} config - 校验后的开关配置（enabled 为 volatile 引用，.get() 读实时值）。
 */
export function apply(ctx, config) {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(
      () => httpCtx.webServer.register({ kind: 'prefix', path: '/blackhole', handler: serveAsset }),
      'theme-blackhole: asset route',
    )
    httpCtx.effect(
      () => httpCtx.webServer.tapIndex(html => injectBootAssets(html, config.enabled.get())),
      'theme-blackhole: boot injection',
    )
  })
  console.log('[theme-blackhole] loaded — 设置 > 通用 > 主题-黑洞 开关控制黑洞主题')
}
