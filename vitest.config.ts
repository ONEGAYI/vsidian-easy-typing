// vitest 冒烟配置：node 环境纯逻辑/结构契约测试（无宿主依赖）。
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
