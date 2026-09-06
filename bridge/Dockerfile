FROM node:22-bookworm-slim
WORKDIR /app
RUN npm install --global pnpm@12.0.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY *.ts ./
USER node
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "main.ts"]
