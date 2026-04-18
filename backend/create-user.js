const bcrypt = require("bcrypt");
const pool = require("./db");

async function createUser() {
  try {
    const name = "Düzgün Şimşek";
    const email = "duzgun.simsek@simsektel.com";
    const plainPassword = "Duzgun2026!";
    const role = "admin";

    const passwordHash = await bcrypt.hash(plainPassword, 10);

    const result = await pool.query(
      `
      INSERT INTO users (name, email, password_hash, role)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email, role, is_active, created_at
      `,
      [name, email, passwordHash, role],
    );

    console.log("Kullanıcı oluşturuldu:");
    console.table(result.rows);
  } catch (err) {
    console.error("USER CREATE ERROR:", err.message);
  } finally {
    await pool.end();
  }
}

createUser();
