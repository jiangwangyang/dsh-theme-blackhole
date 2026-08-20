/**
 * dsh-blackhole-theme — 黑洞主题插件（Host 半边）
 *
 * 通过 webServer 服务 /blackhole/* 静态资源，并以 tapIndex 把它们注入
 * Web UI 的每个 index.html 响应：
 *   - /blackhole/blackhole.css  深空玻璃调色板（--dsw-* 设计令牌覆写）
 *   - /blackhole/blackhole.js   史瓦西黑洞 WebGL 背景渲染器
 *
 * 视觉完全由这两个浏览器资源承载：不依赖客户端插件包，也不用改动
 * monorepo 内置的 ui-theme。资源按请求读盘，改动后浏览器刷新即生效。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Stable Cordis plugin name. */
export const name = 'blackhole-theme'

/** 本插件对外服务的静态资源表：URL 路径 → 相对文件名与 MIME 类型。 */
const ASSETS = {
  '/blackhole/blackhole.js': { file: 'blackhole.js', type: 'text/javascript; charset=utf-8' },
  '/blackhole/blackhole.css': { file: 'blackhole.css', type: 'text/css; charset=utf-8' },
}

/** 资源目录（本文件位于 src/，资源位于 ../assets/）。 */
const ASSET_DIR = fileURLToPath(new URL('../assets/', import.meta.url))

/**
 * 把主题资源标签注入 index.html 的 </head> 之前：vite 把应用样式表以
 * <link> 注入 head，紧随其后追加本主题样式，同等特异性下级联胜出；
 * 脚本 defer，在 DOM 解析完成后、应用模块脚本之前挂载黑洞画布。
 * @param {string} html - 原始 index HTML。
 * @returns {string} 注入资源标签后的 HTML。
 */
function injectThemeAssets(html) {
  const tags = '<link rel="stylesheet" href="/blackhole/blackhole.css">'
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
 * 挂载黑洞主题：注册 /blackhole 前缀路由并给每个 index.html 响应注入
 * 资源标签。等待 webServer 服务就绪后生效，插件卸载时自动回收。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host 插件上下文。
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(
      () => httpCtx.webServer.register({ kind: 'prefix', path: '/blackhole', handler: serveAsset }),
      'blackhole-theme: asset route',
    )
    httpCtx.effect(
      () => httpCtx.webServer.tapIndex(injectThemeAssets),
      'blackhole-theme: index injection',
    )
  })
  console.log('[blackhole-theme] loaded — WebGL black hole background armed')
}
