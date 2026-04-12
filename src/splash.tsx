import React from 'react';
import ReactDOM from 'react-dom/client';
import SplashScreen from './SplashScreen';
import './index.css';

document.documentElement.dataset.splash = 'true';
document.body.dataset.splash = 'true';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <SplashScreen />
  </React.StrictMode>,
);
