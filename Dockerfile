# One container serves the built SPA and the API. Mount a persistent volume at /app/data (see docs/DEPLOYMENT.md).
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=8787 DATA_DIR=/app/data/pg DB_DRIVER=pglite
EXPOSE 8787
CMD ["npm", "start"]
