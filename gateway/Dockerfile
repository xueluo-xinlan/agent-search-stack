# syntax=docker/dockerfile:1
#
# agent_search_gateway —— 多阶段构建
#
#   构建期：装全量依赖（含 tsc/vitest）→ 编译 src/ 到 dist/
#   运行期：只装生产依赖 + chromium，跑 dist/index.js
#
# 镜像里带了 chromium（browser_* 工具与 fetch 路由③需要），因此
# 首次构建需要联网下载浏览器（约 150–200MB），成品镜像约 1.2GB。
# 不需要浏览器能力时，用 --build-arg INSTALL_BROWSER=0 跳过。

ARG NODE_VERSION=24

########## 构建期 ##########
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

########## 运行期 ##########
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ARG INSTALL_BROWSER=1

ENV NODE_ENV=production \
    GATEWAY_CONFIG=/app/gateway.yaml \
    DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# 生产依赖（playwright 在 dependencies 里，必须保留）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# chromium 及其系统依赖（含 --with-deps 所需的 apt 包）
RUN if [ "$INSTALL_BROWSER" = "1" ]; then \
      npx playwright install --with-deps chromium; \
    fi \
 && rm -rf /var/lib/apt/lists/* /tmp/* /root/.npm

COPY --from=build /app/dist ./dist

# 容器内默认配置：host=0.0.0.0、searxng/flaresolverr 指向 compose 服务名。
# 用 docker-compose 挂载覆盖时不生效；裸跑镜像时它就是开箱可用的那份。
COPY docker/gateway.docker.yaml ./gateway.yaml
COPY gateway.yaml.example ./gateway.yaml.example

# 广告过滤 hosts 缓存（建议挂卷持久化，避免每次重建都重新拉取）
RUN mkdir -p /app/data/adblock
VOLUME ["/app/data/adblock"]

EXPOSE 3000

# /health 恒返回 200，报告体内含 searxng / flaresolverr 的 up|down。
# 这里只探「进程是否还能应答」，后端掉线不让容器进重启循环。
HEALTHCHECK --interval=30s --timeout=8s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/index.js"]
