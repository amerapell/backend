# Debian (glibc), not Alpine: the background-removal runtime (onnxruntime-node) has no musl build.

# ---- build ---------------------------------------------------------------
FROM node:20-bookworm-slim AS build
WORKDIR /app
# Skip onnxruntime's ~660 MB CUDA download — background removal runs on CPU.
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json nest-cli.json drizzle.config.ts ./
COPY src ./src
COPY drizzle ./drizzle
RUN npm run build && npm prune --omit=dev \
  # keep only the linux-x64 runtime binaries
  && find node_modules/onnxruntime-node/bin/napi-v3 -mindepth 1 -maxdepth 1 ! -name linux -exec rm -rf {} + \
  && rm -rf node_modules/onnxruntime-node/bin/napi-v3/linux/arm64 \
  && rm -f node_modules/onnxruntime-node/bin/napi-v3/linux/x64/libonnxruntime_providers_cuda.so node_modules/onnxruntime-node/bin/napi-v3/linux/x64/libonnxruntime_providers_tensorrt.so
# Background-removal model: IS-Net general use (DIS, Apache-2.0), ~180 MB, fetched once at build time.
RUN mkdir -p models && node -e "\
  const url='https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx';\
  fetch(url).then(async r=>{if(!r.ok)throw new Error('model download '+r.status);\
  const b=Buffer.from(await r.arrayBuffer());if(b.length<100e6)throw new Error('model too small');\
  require('fs').writeFileSync('models/isnet-general-use.onnx',b);console.log('model',b.length)})\
  .catch(e=>{console.error(e);process.exit(1)})"

# ---- runtime -------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd -r app && useradd -r -g app app
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/models ./models
COPY --chown=app:app assets ./assets
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npm run migrate && (npm run seed -- --if-empty || echo '[seed] skipped after error') && (npm run seed:photos || echo '[seed:photos] skipped after error') && npm run start:prod"]
