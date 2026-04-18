require("dotenv").config();
const { Pool } = require("pg");

console.log("DB MODE:", process.env.DATABASE_URL ? "DATABASE_URL" : "LOCAL_DB");
console.log("DATABASE_URL EXISTS:", !!process.env.DATABASE_URL);

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD || "",
      port: Number(process.env.DB_PORT || 5432),
      ssl: false,
    });

module.exports = pool;