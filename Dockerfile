# backend/Dockerfile — BioCore AI backend (Node.js + Express, ESM)
FROM node:20-alpine

WORKDIR /app

# Bog'liqliklar (faqat production — nodemon kabi dev paketlarsiz)
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Manba kod
COPY src ./src

ENV NODE_ENV=production
EXPOSE 5000

# Soddagina health-check (backend /api/health ga ega)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:5000/api/health || exit 1

CMD ["node", "src/index.js"]
