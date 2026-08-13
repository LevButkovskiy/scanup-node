FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
# ping.v1 shells out to ping; busybox's applet is not supported by the `ping`
# package and lacks unprivileged ICMP socket support, so install iputils.
RUN apk add --no-cache iputils
COPY package.json package-lock.json ./
# --ignore-scripts: the `prepare` script runs husky, which is a devDependency
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/main.js"]
