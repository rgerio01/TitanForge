/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/**/*.{ts,tsx,html}',
  ],
  theme: {
    screens: {
      'xs': '1024px',  // Monitores pequenos
      'sm': '1280px',  // Resolução mínima suportada (HD)
      'md': '1440px',  // Monitores médios
      'lg': '1600px',  // Janela padrão
      'xl': '1920px',  // Full HD
    },
    extend: {
      colors: {
        vortex: {
          // Backgrounds escuros
          'bg-primary': '#0A0A0A',    // Fundo principal (quase preto)
          'bg-secondary': '#1a1a1a',  // Cards e elementos
          'bg-tertiary': '#2d2d2d',   // Elementos hover/destaque

          // Borders e divisores
          'border': '#404040',        // Borders padrão
          'border-light': '#606060',  // Borders em hover

          // Textos
          'text-primary': '#FFFFFF',  // Texto principal
          'text-secondary': '#A0A0A0', // Texto secundário
          'text-tertiary': '#606060',  // Texto desabilitado/placeholder

          // Accent colors (sutis)
          'accent-blue': '#3b82f6',   // Accent azul
          'accent-purple': '#9333ea', // Accent roxo
          'accent-green': '#22c55e',  // Success
          'accent-red': '#ef4444',    // Error/danger
          'accent-yellow': '#eab308', // Warning
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
