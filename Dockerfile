FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY scraper.js config.js ./

# El archivo de proyectos ya vistos vive en un volumen: sin el, cada redeploy
# volveria a notificar todo lo que ya se publico.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

ENV STATE_PATH=/data/seen-projects.json
ENV POLL_SECONDS=300
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=60s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1

CMD ["node", "scraper.js"]
