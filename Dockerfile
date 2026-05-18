FROM node:22-alpine AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY index.html ./
COPY src ./src
RUN npm run build

FROM python:3.13-slim AS runtime
WORKDIR /app
ENV DB_PATH=/data/salary.sqlite
ENV STATIC_DIR=/app/dist
ENV PORT=8080
COPY server ./server
COPY --from=frontend /app/dist ./dist
EXPOSE 8080
CMD ["python", "-m", "server.app"]
