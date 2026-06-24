const { isProduction } = require('./env');

const requireEnv = names => {
  const missing = names.filter(name => !process.env[name]);

  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
};

const requirePair = (left, right) => {
  if ((process.env[left] && !process.env[right]) || (!process.env[left] && process.env[right])) {
    throw new Error(`${left} and ${right} must be configured together`);
  }
};

module.exports = () => {
  requireEnv([
    'DATABASE',
    'DATABASE_PASSWORD',
    'JWT_SECRET',
    'JWT_EXPIRES_IN',
    'JWT_COOKIE_EXPIRES_IN',
  ]);

  requirePair('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET');
  requirePair('GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET');

  if (!isProduction()) return;

  requireEnv(['HOST_URL', 'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY']);

  if (!process.env.HOST_URL.startsWith('https://')) {
    throw new Error('HOST_URL must use https:// in production');
  }

  if (
    process.env.COOKIE_SAME_SITE === 'none' &&
    process.env.COOKIE_SECURE !== 'true'
  ) {
    throw new Error('COOKIE_SAME_SITE=none requires COOKIE_SECURE=true');
  }
};
