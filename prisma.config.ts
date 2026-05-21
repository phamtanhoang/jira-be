import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

dotenv.config();

export default defineConfig({
  schema: path.join(__dirname, "prisma"),
  datasource: {
    url: process.env.DATABASE_URL!,
  },
  migrations: {
    // Prisma 7 reads the seed command from here (the legacy
    // `package.json#prisma.seed` is ignored). Re-run with `npx prisma db seed`.
    seed: "ts-node -r tsconfig-paths/register prisma/seed.ts",
  },
});
