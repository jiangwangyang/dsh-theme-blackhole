/**
 * dsh-llm-proxy — 环境变量代理插件（Host 半边）
 *
 * 通过 undici 的 EnvHttpProxyAgent 读取 HTTP_PROXY / HTTPS_PROXY / NO_PROXY
 * 环境变量，并将其设为全局 dispatcher。Harness 的 LLM 适配器（DeepSeek、
 * Pi-AI 等）底层均使用 Node.js 全局 fetch()，而全局 fetch 由 undici 的
 * 全局 dispatcher 驱动，因此本插件可让所有大模型 API 请求默认走代理。
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
export const name = 'llm-proxy'

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
    console.log('[llm-proxy] no HTTP_PROXY/HTTPS_PROXY env vars set — plugin active, direct connections used')
  } else {
    console.log(
      `[llm-proxy] env proxy detected —`
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
      console.log('[llm-proxy] global dispatcher replaced with EnvHttpProxyAgent')

      return () => {
        setGlobalDispatcher(previous)
        console.log('[llm-proxy] restored previous global dispatcher')
      }
    },
    'llm-proxy: global proxy dispatcher',
  )
}
