// Prints the current authenticator code for the seeded staff accounts.
//   npm run totp            -> uses SEED_ADMIN_TOTP_SECRET from .env
//   npm run totp -- SECRET  -> uses the given base32 secret
import { existsSync } from 'node:fs';
import { generate } from 'otplib';

if (existsSync('.env')) process.loadEnvFile('.env');
const secret = process.argv[2] ?? process.env.SEED_ADMIN_TOTP_SECRET;
if (!secret) {
  console.error('No secret: set SEED_ADMIN_TOTP_SECRET in .env or pass one as an argument.');
  process.exit(1);
}
const code = await generate({ secret });
const secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(`${code}  (valid for about ${secondsLeft}s)`);
