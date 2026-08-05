/**
 * 品牌 logo 的 URL。
 *
 * 不内联 base64：同一张图已经作为 `public/brand-logo.png`（9 KB）随构建产物发布，
 * 内联会让它以 base64 形式再占约 12 KB 进 JS bundle，而且无法被浏览器单独缓存。
 *
 * 用**相对**路径而不是绝对路径，是因为两种构建的部署前缀不同：
 *   - `npm run build:static`（vite.static.config.ts，base 为 "/ternary/"）→ /ternary/brand-logo.png
 *   - vinext / Next 构建（public 挂在根路径）→ /brand-logo.png
 * 相对 URL 由浏览器按文档的 base URI 解析，两种前缀都对，且不依赖任何构建期替换。
 *
 * 注意：不要改成 `import.meta.env.BASE_URL`。加了可选链后 Vite 的静态替换不再匹配，
 * 会静默退回 "/" 并让 logo 在 /ternary/ 下 404。
 *
 * 前提：页面从目录索引提供（URL 以 "/" 结尾）且只有单一路由。若将来加了子路由，
 * 需要改成由构建产出的资源 URL。
 */
export const brandLogo = "brand-logo.png";
