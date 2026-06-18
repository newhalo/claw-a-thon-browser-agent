import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Tooltip from '@radix-ui/react-tooltip';
import App from './App';
import { ThemeProvider } from './lib/ThemeContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <Tooltip.Provider delayDuration={300}>
        <App />
      </Tooltip.Provider>
    </ThemeProvider>
  </React.StrictMode>
);
