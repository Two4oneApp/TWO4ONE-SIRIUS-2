# This app is built on Ionic 3 / Angular 5 / ionic-app-scripts, which depends
# on node-sass@4.12 (native binding, needs node-gyp + python2) and an old
# Node ABI. It will NOT build on modern Node (tested: fails on Node 22 with
# "Node Sass does not yet support your current environment"). Render's
# default Node build image is far newer than this stack supports, so this
# app is built via Docker instead, pinned to a Node version node-sass@4.12
# actually supports.
#
# Longer term: replace node-sass with `sass` (Dart Sass) and upgrade off
# ionic-app-scripts (deprecated since Ionic 4) so this pin is no longer
# needed. See MODERNIZATION.md.

FROM node:10-buster AS build
WORKDIR /app

# node-gyp (used by node-sass, bcrypt, etc.) needs python2 + build tools.
RUN apt-get update && \
    apt-get install -y python2 build-essential && \
    ln -sf /usr/bin/python2 /usr/bin/python && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps --no-audit --no-fund

COPY . .

# Ionic's web build (not the Cordova native build) -- produces static
# files in ./www that any static host, including Render, can serve.
RUN npx ionic-app-scripts build --prod

# ---- Runtime: serve the static output ----
FROM nginx:1.27-alpine
COPY --from=build /app/www /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
