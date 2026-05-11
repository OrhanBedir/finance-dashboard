const { Pool } = require("pg");

const isRemote = !!process.env.DATABASE_URL;

const localConfig = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || "postgres",
  database: process.env.DB_NAME || "postgres",
  max: 10,
};

if (process.env.DB_PASSWORD && process.env.DB_PASSWORD !== "") {
  localConfig.password = process.env.DB_PASSWORD;
}

const remoteConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
};

const pool = new Pool(isRemote ? remoteConfig : localConfig);

module.exports = pool;
