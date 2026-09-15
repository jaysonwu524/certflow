FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/.next ./.next
# Next.js serves files in `public/` directly at runtime. Keep the runtime
# image self-contained so branding, favicon, and other public assets work.
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["npm", "start"]
