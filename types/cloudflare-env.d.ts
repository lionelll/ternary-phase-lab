/**
 * Cloudflare Workers 运行时的最小环境声明。
 *
 * `worker/index.ts` 与 `db/index.ts` 是脚手架模板代码，引用了只存在于 Workers 运行时的
 * 全局类型（Fetcher / D1Database）和虚拟模块（cloudflare:workers）。缺少这份声明时
 * `npx tsc --noEmit` 会以 3 个错误退出，类型检查就无法当作门禁使用。
 *
 * 这里只声明本仓库实际用到的成员。若将来真的开始开发 Worker，请改用官方完整定义：
 *   npx wrangler types          # 生成 worker-configuration.d.ts
 * 然后删除本文件。
 */

/** Workers 的 service binding / 静态资源 binding。 */
interface Fetcher {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

/** D1 预处理语句。成员按 drizzle-orm/d1 的调用面补齐。 */
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>;
}

interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
  error?: string;
}

/** D1 数据库 binding。 */
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
  dump(): Promise<ArrayBuffer>;
}

/** Workers 运行时注入的虚拟模块，导出当前 Worker 的环境绑定。 */
declare module "cloudflare:workers" {
  export const env: {
    DB?: D1Database;
    ASSETS?: Fetcher;
  } & Record<string, unknown>;
}
