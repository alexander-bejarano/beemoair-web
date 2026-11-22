# Tablero del portal (React + TypeScript)

Fuente del Tablero de agencias.beemoair.com. Recharts para los gráficos y Framer Motion para las animaciones.

```
npm install
npm run build   # verifica tipos y escribe ../api/public/dash/dashboard.{js,css}
```

El portal (`api/public/app.js`) carga `/dash/dashboard.js` al abrir la pestaña Tablero y llama a `BeemoDashboard.mount(el, { fetchJson })`.
Los datos vienen de `GET /api/admin/dashboard` (filtros `channel` y `scope`).
