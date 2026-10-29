import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import type { NextConfig } from 'next'

// モノレポのルートにある .env を読む（Next.js は標準では apps/web/ の .env しか読まないため）
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true })

const nextConfig: NextConfig = {
  // workspace の TS パッケージをそのままビルドに含める
  transpilePackages: ['@llmo/db', '@llmo/llm', '@llmo/runner'],
  // typedRoutes は TypeScript 7 で Next が生成する型と噛み合わないため、いったん無効（README の既知の課題を参照）
}

export default nextConfig
