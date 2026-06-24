/* eslint-disable */
import axios from 'axios';
import { showAlert } from './alerts';

const API_URL = 'https://natours-project-2-ihkw.onrender.com';
export const signup = async (name, email, password, passwordConfirm) => {
  try {
    const res = await axios({
      method: 'POST',
      url: `${API_URL}/api/v1/users/signup`,
      // url: '/api/v1/users/signup',
      withCredentials: true,
      data: {
        name,
        email,
        password,
        passwordConfirm,
      },
    });
    if (res.data.status === 'success') {
      showAlert(
        'success',
        'Signed up successfully!\nUse login credentials to log in.'
      );
      window.setTimeout(() => {
        location.assign('/api/v1/users/login');
      }, 2000);
    }
  } catch (err) {
    showAlert('error', err.response.data.message);
  }
};
