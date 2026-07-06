const bcrypt = require("bcrypt");

async function generateHashes() {
    const passwords = [
        "Admin1234",
        "Analyst1234",
        "STRO1234"
    ];

    for (const password of passwords) {
        const hash = await bcrypt.hash(password, 10);
        console.log(`${password} -> ${hash}`);
    }
}

generateHashes();