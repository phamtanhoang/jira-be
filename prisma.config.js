const path = require('node:path');
const dotenv = require('dotenv');
const { defineConfig } = require('prisma/config');

dotenv.config();

module.exports = defineConfig({
  schema: path.join(__dirname, 'prisma'),
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    // Prisma 7 reads the seed command from here (the legacy
    // `package.json#prisma.seed` is ignored). Re-run with `npx prisma db seed`.
    seed: 'ts-node -r tsconfig-paths/register prisma/seed.ts',
  },
});
