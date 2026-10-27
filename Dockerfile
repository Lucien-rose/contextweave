FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node . .
RUN mkdir -p data && chown node:node data \
    && cp deploy/container-entrypoint.sh /usr/local/bin/moss && chmod 755 /usr/local/bin/moss
USER node
ENV MOSS_HTTP_HOST=0.0.0.0 MOSS_CONFIG_DIR=/app/data/config MOSS_DB_PATH=/app/data/moss-memory.sqlite MOSS_IMPORT_DIR=/imports
ENV MOSS_VECTOR_ENV_FILE=/app/data/config/vector.env MOSS_VECTOR_ADMIN_ENV_FILE=/app/data/config/vector.env
EXPOSE 2091
ENTRYPOINT ["moss"]
CMD ["start"]
