# Beemo Air · API y portal de agencias

Un solo inventario para beemoair.com y agencias.beemoair.com: cada silla de cada vuelo se vende una sola vez
(clave única vuelo+silla en SQLite, transacción inmediata). Node 24, sin dependencias.

- `server.mjs` — API (`/api/*`) y portal estático (`public/`).
- Datos en `/data/beemo.db` (volumen Docker `beemo_data`).
- Variables: `ADMIN_SETUP_CODE` (crear el primer administrador), `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` (opcionales; sin ellas las reservas con tarjeta quedan pendientes 24 h y se confirman a mano).
- Webhook de Stripe: `https://beemoair.com/api/stripe/webhook`, evento `checkout.session.completed`.
- Para actualizar el código: reiniciar el contenedor `beemoapi` (descarga `main` al arrancar).
