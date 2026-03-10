// tailwind.config.js
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        'vsc-bg':        '#1e1e1e',
        'vsc-sidebar':   '#252526',
        'vsc-panel':     '#2d2d2d',
        'vsc-border':    '#3e3e42',
        'vsc-text':      '#cccccc',
        'vsc-muted':     '#858585',
        'vsc-accent':    '#4ec9b0',
        'vsc-selected':  '#37373d',
        'vsc-hover':     '#2a2d2e',
      }
    }
  },
  plugins: []
}
