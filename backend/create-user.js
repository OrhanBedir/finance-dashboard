const bcrypt = require("bcrypt");
const pool = require("./db");

require("dotenv").config();

async function upsertUser({ name, email, plainPassword, role = "user" }) {
  const passwordHash = await bcrypt.hash(plainPassword, 10);

  const result = await pool.query(
    `
    INSERT INTO users (name, email, password_hash, role, is_active)
    VALUES ($1, $2, $3, $4, true)
    ON CONFLICT (email)
    DO UPDATE SET
      name = EXCLUDED.name,
      password_hash = EXCLUDED.password_hash,
      role = EXCLUDED.role,
      is_active = true
    RETURNING id, name, email, role, is_active
    `,
    [name, email, passwordHash, role],
  );

  return result.rows[0];
}

async function main() {
  try {
    const users = [
      {
        name: "Nurcan Kuş",
        email: "nurcan.kus@simsektel.com",
        plainPassword: "Nurcan2026!",
        role: "user",
      },
      {
        name: "Serdar Altınova",
        email: "serdar.altinova@simsektel.com",
        plainPassword: "Serdar2026!",
        role: "user",
      },
      {
        name: "Murat İstek",
        email: "murat.istek@simsektel.com",
        plainPassword: "Murat2026!",
        role: "user",
      },

      {
        name: "Orhan Bedir",

        email: "orhan.bedir@simsektel.com",

        plainPassword: "Orhan2026!",

        role: "admin",
      },

      {
        name: "Düzgün Şimşek",

        email: "duzgun.simsek@simsektel.com",

        plainPassword: "Duzgun2026!",

        role: "admin",
      },
      {
        name: "Muhasebe",
        email: "muhasebe@simsektel.com",
        plainPassword: "Muhasebe2026!",
        role: "admin",
      },
    ];

    for (const user of users) {
      const saved = await upsertUser(user);
      console.log("Kaydedildi:", saved);
    }

    process.exit(0);
  } catch (err) {
    console.error("HATA:", err.message);
    process.exit(1);
  }
}

main();
