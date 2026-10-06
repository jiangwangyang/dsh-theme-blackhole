/**
 * dsh-theme-blackhole — 黑洞主题插件（Host 半边）
 *
 * 本插件无开关：加载即启用，卸载即还原。用户经插件管理（禁用/卸载）
 * 关闭主题，不占用设置界面的任何开关行。
 *
 * 主题为纯浏览器侧呈现（令牌覆盖层 + 内联样式表 + WebGL 渲染器，全部
 * 随 client bundle 到达，无静态资源路由、无 index.html 注入），Host 半边
 * 仅承担启停日志；本文件存在是因为 bundle 加载器会导入每一行的 Node 半边。
 *
 * 配色经 ui-theme 的令牌覆盖层（overrideTokens）生效，与 light/dark/system
 * 偏好通道正交：不注册主题 id、不读写主题偏好，卸载时覆盖层随纤维回收自动还原。
 */

/** Cordis 插件名（稳定标识，皮肤切换器据此定位加载行，勿改）。 */
export const name = 'theme-blackhole'

/**
 * Host 半边挂载：打印启用日志，并以 effect 处置函数在禁用/卸载时打印禁用日志。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host 插件上下文。
 */
export function apply(ctx) {
  console.log('[theme-blackhole] loaded — 黑洞主题已启用')
  ctx.effect(() => () => {
    console.log('[theme-blackhole] disabled — 黑洞主题已禁用')
  }, 'theme-blackhole: disabled log')
}
