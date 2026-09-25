# Imagen de producción para Railway (o cualquier servicio de contenedores)
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production

# Dependencias del servidor
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Frontend: se compila y se descartan sus dependencias de desarrollo
COPY frontend/package.json frontend/package-lock.json frontend/
RUN npm --prefix frontend ci --include=dev
COPY . .
RUN npm --prefix frontend run build && rm -rf frontend/node_modules

# Los datos (base SQLite, originales y carpeta de entrada) viven en un volumen persistente
ENV DATA_DIR=/data
EXPOSE 3000
CMD ["node", "backend/server.ts"]
