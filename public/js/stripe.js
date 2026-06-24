/* eslint-disable */
import axios from 'axios';
import { showAlert } from './alerts';

const getStripe = () => {
  const publishableKey = document.body.dataset.stripePublishableKey;

  if (!publishableKey) {
    throw new Error('Stripe publishable key is not configured.');
  }

  return Stripe(publishableKey);
};

export const bookTour = async tourId => {
  try {
    const stripe = getStripe();

    // 1) Get checkout session from API
    const session = await axios(`/api/v1/bookings/checkout-session/${tourId}`);
    console.log(session);

    // 2) Create checkout form + chanre credit card
    await stripe.redirectToCheckout({
      sessionId: session.data.session.id,
    });
  } catch (err) {
    console.log(err);
    showAlert('error', err);
  }
};
