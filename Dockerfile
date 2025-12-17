FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV TZ=Asia/Jakarta
RUN apk add --no-cache tzdata
CMD ["node", "index.js"]