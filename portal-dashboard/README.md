# Tablero del portal (React + TypeScript)

Fuente del Tablero de agencias.beemoair.com. Recharts para los gráficos y Framer Motion para las animaciones.

```
npm install
npm run build   # verifica tipos y escribe ../api/public/dash/dashboard.{js,css}
```

El portal (`api/public/app.js`) carga `/dash/dashboard.js` al abrir la pestaña Tablero y llama a `BeemoDashboard.mount(el, { fetchJson })`.
Los datos vienen de `GET /api/admin/dashboard` (filtros `channel` y `scope`).

## Canales y convenios (pestaña Agencias)

El mismo paquete trae la caja «Canales y convenios»: `BeemoDashboard.mountChannels(el, { fetchJson, saveJson })`, montada por `viewAgencies()` en `api/public/app.js`.

- `src/channels/math.ts`: el cálculo de la hoja «Canales» del modelo financiero (comisión, monto fijo, cargo web, pasajeros que se pierden, pasarela), los esquemas para comparar y la ganancia por tiquete.
- `src/channels/Channels.tsx` y `parts.tsx`: las tres vistas (Simulador, Por tiquete, Monitoreo) y sus gráficas.
- Datos: `GET /api/admin/channels` (ventas reales por canal, base del modelo cargado en Finanzas y escenario guardado) y `PUT /api/admin/channels` (guarda el escenario).
- La base sale del modelo activo en Finanzas. Si el Excel trae las hojas «Canales» y «Familias de tarifa», se leen de ahí las sillas, la mezcla de tarifas y las cifras del modelo original.
