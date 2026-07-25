import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

// ========================================
// PROTEÇÕES DE SEGURANÇA CONTRA DEVTOOLS
// ========================================

// 1. Bloquear menu de contexto (botão direito)
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

// 2. Bloquear atalhos de DevTools
document.addEventListener('keydown', (e) => {
  // F12 - DevTools
  if (e.key === 'F12') {
    e.preventDefault();
  }

  // Ctrl+Shift+I - Inspecionar elemento
  if (e.ctrlKey && e.shiftKey && e.key === 'I') {
    e.preventDefault();
  }

  // Ctrl+Shift+J - Console
  if (e.ctrlKey && e.shiftKey && e.key === 'J') {
    e.preventDefault();
  }

  // Ctrl+Shift+C - Seletor de elementos
  if (e.ctrlKey && e.shiftKey && e.key === 'C') {
    e.preventDefault();
  }

  // Ctrl+U - Ver código fonte
  if (e.ctrlKey && e.key === 'u') {
    e.preventDefault();
  }

  // Ctrl+S - Salvar página
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
  }
});

// 3. Bloquear seleção de texto via JS (backup do CSS)
document.addEventListener('selectstart', (e) => {
  // Permitir apenas em inputs
  const target = e.target as HTMLElement;
  if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
    e.preventDefault();
  }
});

// 4. Bloquear copiar (Ctrl+C) fora de inputs
document.addEventListener('copy', (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
    e.preventDefault();
  }
});

// 5. Bloquear arrastar e soltar
document.addEventListener('dragstart', (e) => {
  e.preventDefault();
});

// ========================================
// RENDERIZAR APP
// ========================================

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
