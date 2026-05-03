const { Pool } = require("pg");

const isRailway = !!process.env.DATABASE_URL;

const localConfig = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || "postgres",
  database: process.env.DB_NAME || "postgres",
};

if (process.env.DB_PASSWORD && process.env.DB_PASSWORD !== "") {
  localConfig.password = process.env.DB_PASSWORD;
}

const pool = new Pool(
  isRailway
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      }
    : localConfig
);

module.exports = pool;