import React from 'react';
import ReactDOM from 'react-dom/client';
import { ErrorBoundary } from './components/feedback/ErrorBoundary';
import App from './App';
import './styles/index.css';

const rootElement = document.getElementById('root');

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary boundaryName="AppBootstrapErrorBoundary">
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
