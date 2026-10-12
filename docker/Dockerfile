FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM grafana/grafana-oss:12.0.0
COPY --from=build --chown=grafana:root /app/dist /var/lib/grafana/plugins/llm-traces-app
COPY --chown=grafana:root provisioning/plugins /etc/grafana/provisioning/plugins
COPY --chown=grafana:root provisioning/datasources/tempo.yaml /etc/grafana/provisioning/datasources/tempo.yaml
