# Befine Store (modo local) — servidor Node + base SQLite
FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY server/ server/
COPY web/ web/
ENV HOST=0.0.0.0 PORT=8080 BEFINE_DATA_DIR=/app/data
VOLUME /app/data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://localhost:8080/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
