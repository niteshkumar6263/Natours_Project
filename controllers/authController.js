const crypto = require('crypto');
const { promisify } = require('util');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const User = require('./../models/userModel');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/appError');
const Email = require('./../utils/email');
const { buildHostUrl, getHostUrl } = require('./../utils/hostUrl');

const signToken = id => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

const getOAuthCallbackUrl = (req, provider) => {
  const envVar = process.env[`${provider.toUpperCase()}_CALLBACK_URL`];
  if (envVar) {
    return envVar.replace('${HOST_URL}', getHostUrl());
  }

  return buildHostUrl(`/api/v1/users/auth/${provider}/callback`);
};

const getCookieOptions = () => {
  const cookieOptions = {
    httpOnly: true,
    sameSite: process.env.COOKIE_SAME_SITE || 'lax',
    path: '/',
  };

  if (process.env.COOKIE_DOMAIN)
    cookieOptions.domain = process.env.COOKIE_DOMAIN;
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.COOKIE_SECURE === 'true'
  ) {
    cookieOptions.secure = true;
  }

  return cookieOptions;
};

const createLoginCookie = (user, res) => {
  const token = signToken(user._id);
  const cookieOptions = {
    ...getCookieOptions(),
    expires: new Date(
      Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000
    ),
  };

  res.cookie('jwt', token, cookieOptions);

  return token;
};

const createSendToken = (user, statusCode, res) => {
  const token = createLoginCookie(user, res);

  // Remove password from output
  user.password = undefined;

  res.status(statusCode).json({
    status: 'success',
    token,
    data: {
      user,
    },
  });
};

exports.signup = catchAsync(async (req, res) => {
  const newUser = await User.create({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
  });

  const url = buildHostUrl('/me');
  console.log(url);
  // ----> Mail Sending
  // await new Email(newUser, url).sendWelcome();

  createSendToken(newUser, 201, res);
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  // 1) Check if email and password exist
  if (!email || !password) {
    return next(new AppError('Please provide email and password!', 400));
  }
  // 2) Check if user exists && password is correct
  const user = await User.findOne({ email }).select('+password');

  if (!user) {
    return next(new AppError('Incorrect email or password', 401));
  }

  if (!user.password) {
    return next(
      new AppError(
        'This account uses social login. Please continue with Google or GitHub.',
        401
      )
    );
  }

  if (!(await user.correctPassword(password, user.password))) {
    return next(new AppError('Incorrect email or password', 401));
  }

  // 3) If everything ok, send token to client
  createSendToken(user, 200, res);
});

exports.googleLogin = (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return next(new AppError('Google login is not configured yet.', 500));
  }

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: getOAuthCallbackUrl(req, 'google'),
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
};

exports.githubLogin = (req, res, next) => {
  if (!process.env.GITHUB_CLIENT_ID) {
    return next(new AppError('GitHub login is not configured yet.', 500));
  }

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: getOAuthCallbackUrl(req, 'github'),
    scope: 'read:user user:email',
    allow_signup: 'true',
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
};

exports.googleCallback = catchAsync(async (req, res, next) => {
  if (req.query.error) {
    return next(new AppError('Google login was cancelled.', 400));
  }

  if (!req.query.code) {
    return next(
      new AppError('Google did not return an authorization code.', 400)
    );
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return next(new AppError('Google login is not configured yet.', 500));
  }

  const tokenParams = new URLSearchParams({
    code: req.query.code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: getOAuthCallbackUrl(req, 'google'),
    grant_type: 'authorization_code',
  });

  const tokenResponse = await axios.post(
    'https://oauth2.googleapis.com/token',
    tokenParams.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  const profileResponse = await axios.get(
    'https://www.googleapis.com/oauth2/v3/userinfo',
    {
      headers: {
        Authorization: `Bearer ${tokenResponse.data.access_token}`,
      },
    }
  );

  const profile = profileResponse.data;

  if (!profile.email || !profile.email_verified) {
    return next(
      new AppError('Your Google account email is not verified.', 401)
    );
  }

  let user = await User.findOne({ email: profile.email }).select(
    '+googleId +githubId'
  );

  if (!user) {
    user = await User.create({
      name: profile.name || profile.email.split('@')[0],
      email: profile.email,
      photo: profile.picture,
      googleId: profile.sub,
      authProvider: 'google',
    });
  } else if (!user.googleId) {
    user.googleId = profile.sub;
    if (profile.picture && user.photo.includes('default_oim9am')) {
      user.photo = profile.picture;
    }
    await user.save({ validateBeforeSave: false });
  }
  createLoginCookie(user, res);
  res.redirect('/');
});

exports.githubCallback = catchAsync(async (req, res, next) => {
  if (req.query.error) {
    return next(new AppError('GitHub login was cancelled.', 400));
  }

  if (!req.query.code) {
    return next(
      new AppError('GitHub did not return an authorization code.', 400)
    );
  }

  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    return next(new AppError('GitHub login is not configured yet.', 500));
  }

  const tokenParams = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    client_secret: process.env.GITHUB_CLIENT_SECRET,
    code: req.query.code,
    redirect_uri: getOAuthCallbackUrl(req, 'github'),
  });

  const tokenResponse = await axios.post(
    'https://github.com/login/oauth/access_token',
    tokenParams.toString(),
    {
      headers: {
        Accept: 'application/json',
      },
    }
  );

  const accessToken = tokenResponse.data.access_token;
  if (!accessToken) {
    return next(new AppError('Unable to obtain GitHub access token.', 500));
  }

  const profileResponse = await axios.get('https://api.github.com/user', {
    headers: {
      Authorization: `token ${accessToken}`,
      Accept: 'application/vnd.github+json',
    },
  });

  const profile = profileResponse.data;
  let email = profile.email;

  if (!email) {
    const emailsResponse = await axios.get(
      'https://api.github.com/user/emails',
      {
        headers: {
          Authorization: `token ${accessToken}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );

    const emailRecord =
      emailsResponse.data.find(e => e.primary && e.verified) ||
      emailsResponse.data.find(e => e.verified);

    if (emailRecord) email = emailRecord.email;
  }

  if (!email) {
    return next(
      new AppError(
        'Could not determine a verified email address from GitHub.',
        401
      )
    );
  }

  let user = await User.findOne({ email }).select('+googleId +githubId');

  if (!user) {
    user = await User.create({
      name: profile.name || profile.login,
      email,
      photo: profile.avatar_url,
      githubId: profile.id,
      authProvider: 'github',
    });
  } else if (!user.githubId) {
    user.githubId = profile.id;
    if (profile.avatar_url && user.photo.includes('default_oim9am')) {
      user.photo = profile.avatar_url;
    }
    await user.save({ validateBeforeSave: false });
  }

  createLoginCookie(user, res);
  res.redirect('/');
});

exports.logout = (req, res) => {
  const cookieOptions = getCookieOptions();

  // Clear the cookie (send an expired cookie). Using both clearCookie
  // and setting a blank cookie to be robust across environments.
  res.clearCookie('jwt', cookieOptions);
  res.cookie('jwt', '', { ...cookieOptions, expires: new Date(0) });

  // If the client expects HTML (browser), redirect to homepage.
  if (req.headers.accept && req.headers.accept.includes('text/html')) {
    return res.redirect('/');
  }

  // Otherwise return JSON for API clients.
  res.status(200).json({ status: 'success' });
};

exports.protect = catchAsync(async (req, res, next) => {
  // 1) Getting token and check of it's there
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  if (!token) {
    return next(
      new AppError('You are not logged in! Please log in to get access.', 401)
    );
  }

  // 2) Verification token
  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

  // 3) Check if user still exists
  const currentUser = await User.findById(decoded.id);
  if (!currentUser) {
    return next(
      new AppError(
        'The user belonging to this token does no longer exist.',
        401
      )
    );
  }

  // 4) Check if user changed password after the token was issued
  if (currentUser.changedPasswordAfter(decoded.iat)) {
    return next(
      new AppError('User recently changed password! Please log in again.', 401)
    );
  }

  // GRANT ACCESS TO PROTECTED ROUTE
  req.user = currentUser;
  res.locals.user = currentUser;
  next();
});

// Only for rendered pages, no errors!
exports.isLoggedIn = async (req, res, next) => {
  if (req.cookies.jwt) {
    try {
      // 1) verify token
      const decoded = await promisify(jwt.verify)(
        req.cookies.jwt,
        process.env.JWT_SECRET
      );

      // 2) Check if user still exists
      const currentUser = await User.findById(decoded.id);
      if (!currentUser) {
        return next();
      }

      // 3) Check if user changed password after the token was issued
      if (currentUser.changedPasswordAfter(decoded.iat)) {
        return next();
      }

      // THERE IS A LOGGED IN USER
      res.locals.user = currentUser;
      return next();
    } catch (err) {
      return next();
    }
  }
  next();
};

exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    // roles ['admin', 'lead-guide']. role='user'
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to perform this action', 403)
      );
    }

    next();
  };
};

exports.forgotPassword = catchAsync(async (req, res, next) => {
  // 1) Get user based on POSTed email
  const user = await User.findOne({ email: req.body.email });
  if (!user) {
    return next(new AppError('There is no user with email address.', 404));
  }

  // 2) Generate the random reset token
  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  // 3) Send it to user's email
  try {
    const resetURL = buildHostUrl(`/api/v1/users/resetPassword/${resetToken}`);
    await new Email(user, resetURL).sendPasswordReset();

    res.status(200).json({
      status: 'success',
      message: 'Token sent to email!',
    });
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    return next(
      new AppError('There was an error sending the email. Try again later!'),
      500
    );
  }
});

exports.resetPassword = catchAsync(async (req, res, next) => {
  // 1) Get user based on the token
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  // 2) If token has not expired, and there is user, set the new password
  if (!user) {
    return next(new AppError('Token is invalid or has expired', 400));
  }
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  // 3) Update changedPasswordAt property for the user
  // 4) Log the user in, send JWT
  createSendToken(user, 200, res);
});

exports.updatePassword = catchAsync(async (req, res, next) => {
  // 1) Get user from collection
  const user = await User.findById(req.user.id).select('+password');

  // 2) Check if POSTed current password is correct
  if (!user.password) {
    return next(
      new AppError(
        'This account uses social login and has no password to update.',
        400
      )
    );
  }

  if (!(await user.correctPassword(req.body.passwordCurrent, user.password))) {
    return next(new AppError('Your current password is wrong.', 401));
  }

  // 3) If so, update password
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  await user.save();
  // User.findByIdAndUpdate will NOT work as intended!

  // 4) Log user in, send JWT
  createSendToken(user, 200, res);
});
