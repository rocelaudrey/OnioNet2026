// All secrets come from environment variables (Vercel env vars in production,
// a local .env in development). Never hardcode them.
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  get mongodbUri() { return required('MONGODB_URI'); },
  get jwtSecret() { return required('JWT_SECRET'); },
  get qrHmacSecret() { return required('QR_HMAC_SECRET'); },
  isProduction: process.env.NODE_ENV === 'production',
};
