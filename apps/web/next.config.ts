import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // workspace の TS パッケージをそのままビルドに含める
  transpilePackages: ['@llmo/db'],
  typedRoutes: true,
}

export default nextConfig
