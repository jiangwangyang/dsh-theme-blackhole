/**
 * dsh-proxy — 环境变量代理插件（Host 半边）
 *
 * 通过 undici 的 EnvHttpProxyAgent 读取 HTTP_PROXY / HTTPS_PROXY / NO_PROXY
 * 环境变量，并将其设为全局 dispatcher。Node.js 全局 fetch() 由 undici 的
 * 全局 dispatcher 驱动，因此本插件让进程内所有 fetch() 请求（LLM 适配器的
 * 大模型 API 请求、web_search 等）默认走代理——它不针对某个具体服务。
 *
 *   - HTTP_PROXY  / http_proxy   HTTP  请求代理
 *   - HTTPS_PROXY / https_proxy  HTTPS 请求代理
 *   - NO_PROXY    / no_proxy     不走代理的主机/域后缀列表（逗号分隔）
 *
 * 未设置任何代理环境变量时，EnvHttpProxyAgent 等价于直连，不会破坏现有行为。
 * 插件卸载时自动恢复前一个全局 dispatcher。
 */
import { EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'

/** Stable Cordis plugin name. */
export const name = 'proxy'

/**
 * 读取并规范化当前进程的代理环境变量，仅用于启动日志展示。
 * @returns {{httpProxy: string, httpsProxy: string, noProxy: string}}
 */
function readProxyEnv() {
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy || ''
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy || ''
  const noProxy = process.env.NO_PROXY || process.env.no_proxy || ''
  return { httpProxy, httpsProxy, noProxy }
}

/**
 * 挂载代理：创建 EnvHttpProxyAgent 并设为全局 dispatcher，使所有 fetch()
 * 调用（含 LLM 适配器的大模型 API 请求）默认走环境变量配置的代理。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host 插件上下文。
 */
export function apply(ctx) {
  const { httpProxy, httpsProxy, noProxy } = readProxyEnv()

  if (!httpProxy && !httpsProxy) {
    console.log('[proxy] no HTTP_PROXY/HTTPS_PROXY env vars set — plugin active, direct connections used')
  } else {
    console.log(
      `[proxy] env proxy detected —`
      + ` HTTP_PROXY=${httpProxy || '(unset)'}`
      + `, HTTPS_PROXY=${httpsProxy || '(unset)'}`
      + `, NO_PROXY=${noProxy || '(unset)'}`,
    )
  }

  // effect(fn) 立即执行 fn（setup），其返回值作为卸载时的清理函数。
  // setup：保存当前 dispatcher 并替换为 EnvHttpProxyAgent；
  // cleanup：插件卸载时恢复前一个 dispatcher。
  ctx.effect(
    () => {
      const previous = getGlobalDispatcher()
      setGlobalDispatcher(new EnvHttpProxyAgent())
      console.log('[proxy] global dispatcher replaced with EnvHttpProxyAgent')

      return () => {
        setGlobalDispatcher(previous)
        console.log('[proxy] restored previous global dispatcher')
      }
    },
    'proxy: global proxy dispatcher',
  )
}
