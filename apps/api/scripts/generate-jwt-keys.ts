/**
 * Generate RS256 JWT key pair for LIBERTASIAN auth.
 *
 * Usage:
 *   npx ts-node scripts/generate-jwt-keys.ts
 *
 * Outputs:
 *   secrets/jwt-private.pem
 *   secrets/jwt-public.pem
 *
 * These files are gitignored. Copy the keys to .env as
 * JWT_PRIVATE_KEY and JWT_PUBLIC_KEY (base64-encoded) for
 * environments that don't use file paths.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const secretsDir = path.resolve(__dirname, '..', 'secrets');

if (!fs.existsSync(secretsDir)) {
  fs.mkdirSync(secretsDir, { recursive: true });
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const privatePath = path.join(secretsDir, 'jwt-private.pem');
const publicPath = path.join(secretsDir, 'jwt-public.pem');

fs.writeFileSync(privatePath, privateKey, 'utf8');
fs.writeFileSync(publicPath, publicKey, 'utf8');

// Also output base64-encoded versions for .env usage
const privateB64 = Buffer.from(privateKey).toString('base64');
const publicB64 = Buffer.from(publicKey).toString('base64');

process.stdout.write('\nRS256 JWT key pair generated successfully.\n\n');
process.stdout.write(`Files:\n  ${privatePath}\n  ${publicPath}\n\n`);
process.stdout.write('For .env (base64-encoded, single line):\n\n');
process.stdout.write(`JWT_PRIVATE_KEY=${privateB64}\n\n`);
process.stdout.write(`JWT_PUBLIC_KEY=${publicB64}\n\n`);
process.stdout.write('Or use file paths:\n\n');
process.stdout.write(`JWT_PRIVATE_KEY_PATH=${privatePath}\n`);
process.stdout.write(`JWT_PUBLIC_KEY_PATH=${publicPath}\n`);
