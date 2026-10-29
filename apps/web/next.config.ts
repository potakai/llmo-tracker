import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // workspace の TS パッケージをそのままビルドに含める
  transpilePackages: ['@llmo/db', '@llmo/llm', '@llmo/runner'],
  typedRoutes: true,
}

export default nextConfig
