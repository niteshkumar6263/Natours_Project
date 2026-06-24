const path = require('path');
const express = require('express');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const AppError = require('./utils/appError');
const globalErrorHandler = require('./controllers/errorController');
const tourRouter = require('./routes/tourRoutes');
const userRouter = require('./routes/userRoutes');
const reviewRouter = require('./routes/reviewRoutes');
const bookingRouter = require('./routes/bookingRoutes');
const viewRouter = require('./routes/viewRoutes');
const compression = require('compression');
const { isLoggedIn } = require('./controllers/authController');
const {
  envList,
  getCorsOrigins,
  getStripePublishableKey,
  isProduction,
} = require('./utils/env');
const app = express();

app.set('trust proxy', 1);

app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));
app.locals.stripePublishableKey = getStripePublishableKey();

const corsOptions = {
  origin(origin, callback) {
    const allowedOrigins = getCorsOrigins();

    if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ''))) {
      return callback(null, true);
    }

    return callback(new AppError('Not allowed by CORS', 403));
  },
  credentials: true,
};

const cspDirectives = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
  styleSrc: [
    "'self'",
    "'unsafe-inline'",
    'https://fonts.googleapis.com',
    'https://api.mapbox.com',
    ...envList(process.env.CSP_STYLE_SRC),
  ],
  scriptSrc: [
    "'self'",
    'https://js.stripe.com',
    'https://api.mapbox.com',
    ...envList(process.env.CSP_SCRIPT_SRC),
  ],
  frameSrc: ["'self'", 'https://js.stripe.com'],
  connectSrc: [
    "'self'",
    'https://api.stripe.com',
    'https://api.mapbox.com',
    'https://events.mapbox.com',
    ...envList(process.env.CSP_CONNECT_SRC),
  ],
  imgSrc: [
    "'self'",
    'data:',
    'blob:',
    'https://res.cloudinary.com',
    'https://lh3.googleusercontent.com',
    'https://avatars.githubusercontent.com',
    'https://api.mapbox.com',
    ...envList(process.env.CSP_IMG_SRC),
  ],
};

if (isProduction()) cspDirectives.upgradeInsecureRequests = [];

// 1) GLOBAL MIDDLEWARES
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
// Set security HTTP headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: cspDirectives,
    },
  })
);
// Serving static files
app.use(express.static(path.join(__dirname, 'public')));

// Development logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Limit requests from same API
const limiter = rateLimit({
  max: 100,
  windowMs: 60 * 60 * 1000,
  message: 'Too many requests from this IP, please try again in an hour!',
});
app.use('/api', limiter);

// Body parser, reading data from body into req.body
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());
// Data sanitization against NoSQL query injection
app.use(mongoSanitize());

// Data sanitization against XSS
app.use(xss());

// Prevent parameter pollution
app.use(
  hpp({
    whitelist: [
      'duration',
      'ratingsQuantity',
      'ratingsAverage',
      'maxGroupSize',
      'difficulty',
      'price',
    ],
  })
);

app.use(compression());
// Test middleware
app.use((req, res, next) => {
  req.requestTime = new Date().toISOString();
  // console.log(req.cookies);
  next();
});

app.use(isLoggedIn);
// 3) ROUTES
app.use('/', viewRouter);
app.use('/api/v1/tours', tourRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1/reviews', reviewRouter);
app.use('/api/v1/bookings', bookingRouter);

// app.all('*', (req, res, next) => {
//   next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
// });

app.use(globalErrorHandler);

module.exports = app;
