const bcrypt = require("bcrypt");

async function generateHash() {
  const hash = await bcrypt.hash("Admin1234", 10);
  console.log(hash);
}

generateHash();