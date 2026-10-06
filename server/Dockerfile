# SCUT 同步服务镜像；构建上下文为 server/ 目录
FROM node:22-alpine

WORKDIR /server
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# 交叉编译好的 Linux 元数据提取器（x86_64 musl 静态链接，见 server/bin/）
# Windows 侧上传会丢执行位，构建时强制补上
COPY bin/xrk-meta /app/bin/xrk-meta
RUN chmod +x /app/bin/xrk-meta
ENV PATH="/app/bin:${PATH}"

# local-server.mjs 以相对 CWD 的 "server/admin-ui" 定位管理页资源，回到根目录再启动
WORKDIR /
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "server/local-server.mjs"]
