FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
# 공공데이터 공중화장실 (서버 시작 때 DB 가 비어 있으면 자동으로 넣음)
COPY seed ./seed
# 데이터는 DATABASE_URL(PostgreSQL)에 저장. 없으면 /app/data/toilets.json
EXPOSE 3000
CMD ["node", "server/index.js"]
