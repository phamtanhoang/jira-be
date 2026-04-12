const path = require('node:path');
const dotenv = require('dotenv');
const { defineConfig } = require('prisma/config');

dotenv.config();

module.exports = defineConfig({
  schema: path.join(__dirname, 'prisma'),
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
