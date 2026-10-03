# syntax=docker/dockerfile:1.7
FROM node:26-bookworm-slim

ARG MEILISEARCH_VERSION=v1.13.3
ARG SCRAPLING_VERSION=0.4.15
ARG RENDER_GIT_COMMIT=""

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright \
    MONGOMS_DISABLE_POSTINSTALL=1 \
    SCRAPLING_VENV=/opt/scrapling-venv \
    PATH=/opt/scrapling-venv/bin:$PATH

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git python3 python3-venv tini \
 && rm -rf /var/lib/apt/lists/*

RUN arch="$(dpkg --print-architecture)" \
 && case "$arch" in \
      amd64) MEILI_ASSET=meilisearch-linux-amd64 ;; \
      arm64) MEILI_ASSET=meilisearch-linux-aarch64 ;; \
      *) echo "unsupported architecture $arch" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /usr/local/bin/meilisearch \
      "https://github.com/meilisearch/meilisearch/releases/download/${MEILISEARCH_VERSION}/${MEILI_ASSET}" \
 && chmod 0755 /usr/local/bin/meilisearch

RUN python3 -m venv "$SCRAPLING_VENV" \
 && pip install --no-cache-dir "scrapling[fetchers]==${SCRAPLING_VERSION}" \
 && scrapling install \
 && chmod -R a+rX "$PLAYWRIGHT_BROWSERS_PATH"

RUN npm install -g corepack@0.36.0 && corepack enable

RUN useradd --create-home --uid 10001 sweeper
WORKDIR /app
RUN chown sweeper:sweeper /app
USER sweeper

COPY --chown=sweeper:sweeper .yarnrc.yml package.json ./
COPY --chown=sweeper:sweeper server/package.json server/yarn.lock server/
RUN corepack install && yarn --cwd server install --immutable

COPY --chown=sweeper:sweeper . .

ENV RENDER_GIT_COMMIT=${RENDER_GIT_COMMIT} \
    SCRAPER_ENV=development \
    SCRAPLING_RENDERER_ENABLED=false

ENTRYPOINT ["/usr/bin/tini", "--", "/app/deploy/sweep-runner/entrypoint.sh"]
CMD ["--confirm-weekly-development-sweep"]
