FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm","start"]