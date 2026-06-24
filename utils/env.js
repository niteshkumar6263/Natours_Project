const envList = value =>
  value
    ? value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
    : [];

const isProduction = () => process.env.NODE_ENV === 'production';

const getCorsOrigins = () => {
  const origins = envList(process.env.CORS_ORIGINS);
  if (process.env.HOST_URL) origins.push(process.env.HOST_URL);

  return [...new Set(origins.map(origin => origin.replace(/\/$/, '')))];
};

const getStripePublishableKey = () => process.env.STRIPE_PUBLISHABLE_KEY || '';

module.exports = {
  envList,
  getCorsOrigins,
  getStripePublishableKey,
  isProduction,
};
