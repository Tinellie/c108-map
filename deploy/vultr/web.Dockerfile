FROM node:22-alpine AS build
WORKDIR /app/viewer-app

COPY viewer-app/package.json viewer-app/package-lock.json ./
RUN npm ci

COPY viewer-app .

ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/vultr/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/viewer-app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
