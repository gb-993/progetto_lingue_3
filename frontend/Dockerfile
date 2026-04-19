FROM node:20-slim
WORKDIR /app
# Copiamo i file di configurazione se esistono già
COPY package*.json ./
RUN npm install
COPY . .
CMD ["npm", "run", "dev", "--", "--host"]