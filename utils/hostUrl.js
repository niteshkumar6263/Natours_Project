exports.getHostUrl = () => {
  if (!process.env.HOST_URL) {
    throw new Error('HOST_URL must be set in config.env');
  }

  return process.env.HOST_URL.replace(/\/$/, '');
};

exports.buildHostUrl = path => `${exports.getHostUrl()}${path}`;
