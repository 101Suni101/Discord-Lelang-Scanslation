FROM node:18-alpine
RUN apk add --no-cache tzdata
ENV TZ=Asia/Jakarta
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["node", "index.js"]
