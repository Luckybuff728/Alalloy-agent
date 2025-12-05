# ================================
# Alalloy Agent 前端 Dockerfile
# 多阶段构建：Node 构建 + Nginx 运行
# ================================

# ---- 构建阶段 ----
FROM node:20-alpine AS builder

WORKDIR /app

# 复制依赖文件
COPY package.json package-lock.json ./

# 安装依赖
RUN npm ci

# 复制源代码
COPY . .

# 构建生产版本
RUN npm run build

# ---- 运行阶段 ----
FROM nginx:alpine

# 复制 nginx 配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 复制构建产物
COPY --from=builder /app/dist /usr/share/nginx/html

# 暴露端口
EXPOSE 80

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

# 启动 nginx
CMD ["nginx", "-g", "daemon off;"]
