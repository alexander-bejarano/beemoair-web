# Beemo Air · API y portal de agencias

Un solo inventario para beemoair.com y agencias.beemoair.com: cada silla de cada vuelo se vende una sola vez
(clave única vuelo+silla en SQLite, transacción inmediata). Node 24, sin dependencias.

- `server.mjs` — API (`/api/*`) y portal estático (`public/`).
- Datos en `/data/beemo.db` (volumen Docker `beemo_data`).
- Variables: `ADMIN_SETUP_CODE` (crear el primer administrador), `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` (opcionales; sin ellas las reservas con tarjeta quedan pendientes 24 h y se confirman a mano).
- Webhook de Stripe: `https://beemoair.com/api/stripe/webhook`, evento `checkout.session.completed`.
- Para actualizar el código: reiniciar el contenedor `beemoapi` (descarga `main` al arrancar).

## UCP: venta a través de agentes de IA

Beemo Air habla el [Universal Commerce Protocol](https://ucp.dev) (versiones 2026-08-25 y 2026-04-08), el estándar que usan Google AI Mode y Gemini para comprar sin salir de la conversación. Usa el mismo inventario y las mismas tarifas del sitio: todo precio sale de `quote()` y toda silla de `createBooking()`.

- **Perfil público:** `https://beemoair.com/.well-known/ucp` (el mismo documento responde en `/api/ucp/profile`). El proxy debe enviar `/.well-known/ucp` y `/.well-known/ucp/*` al contenedor `beemoapi`, igual que `/api/`; en el VPS lo hace el proyecto Docker `beemoucp`, que solo lleva esa regla de Traefik.
- **API REST:** `https://beemoair.com/api/ucp/v1`
  - Catálogo: `POST /catalog/search`, `POST /catalog/lookup`, `POST /catalog/product`.
  - Checkout nativo: `POST /checkout-sessions`, `GET` y `PUT /checkout-sessions/{id}`, `POST /checkout-sessions/{id}/complete`, `POST /checkout-sessions/{id}/cancel`.
  - Pedidos: `GET /orders/{id}` (solo para la plataforma que originó el pedido, autenticada con firma o llave).
- **Artículos:** un vuelo con su tarifa, por ejemplo `BM701-20261214-classic`. Una compra lleva la ida o la ida y el regreso, de 1 a 9 pasajeros. Sillas automáticas; extras, infantes, pases y BEE CLUB siguen en el sitio y en «Mi reserva».
- **Pasajeros:** el tiquete se emite a nombre de quien viaja, así que los nombres se piden de forma explícita con la extensión `com.beemoair.shopping.passengers` (campo `passengers`). Si la plataforma no la maneja, la compra pasa a `continue_url`: la página `/api/ucp/continue/{id}`, donde el comprador confirma los nombres y paga.
- **Pago nativo:** se anuncia Google Pay (con Stripe como pasarela) o Stripe Payments solo si están sus variables. Sin ellas no se anuncia ningún medio de pago y toda compra termina en la página de `continue_url`, con el flujo de pago actual del sitio.
- **Pedido:** nace cuando la reserva queda pagada (cobro nativo, Stripe en la web o confirmación manual en el portal). La plataforma recibe la foto completa del pedido en su `webhook_url`, firmada con ES256 (RFC 9421) y con reintentos; después de volar, cada trayecto queda entregado; si la reserva se anula, el pedido queda cancelado. El reembolso del dinero se sigue haciendo en Stripe.
- **Portal:** las ventas aparecen como canal «Agentes de IA (UCP)». Estado en `GET /api/admin/ucp`; `POST /api/admin/ucp/retry` reintenta los eventos pendientes.

Variables, todas opcionales:

| Variable | Para qué |
| --- | --- |
| `UCP_ENABLED=0` | Apaga todo UCP (responde 404). |
| `UCP_VERSION` | Versión del perfil raíz. Por defecto `2026-08-25`, que además anuncia `2026-04-08`. Con `2026-04-08` (la que documenta Google) solo se atiende esa. |
| `STRIPE_PUBLISHABLE_KEY` + `UCP_GPAY_MERCHANT_ID` | Con `STRIPE_SECRET_KEY`, anuncian Google Pay. `UCP_GPAY_ENV=PRODUCTION` cuando Google apruebe la cuenta (por defecto `TEST`). |
| `STRIPE_UCP_PROFILE` | Perfil de Stripe (`profile_…`) para anunciar Stripe Payments (`com.stripe.payments`). `STRIPE_UCP_ENV` cambia el ambiente que se anuncia. |
| `UCP_BUYER_IS_PASSENGER=1` | Con un solo tiquete y sin nombres de pasajeros, emite a nombre del comprador y lo avisa antes del pago. Apagado por defecto. |
| `UCP_API_KEYS` | Llaves para plataformas: `nombre:llave,nombre2:llave2` (`X-API-Key` o `Authorization: Bearer`). |
| `UCP_REQUIRE_AUTH=1` | Exige llave o firma válida en cada solicitud. |
| `UCP_GOOGLE_WEBHOOK_URL` | Dirección que entrega Google para los eventos de pedido. |
| `UCP_SIGNING_KEY` | Llave privada EC P-256 en JWK. Si falta, se crea una y se guarda en la base de datos. |
| `UCP_SESSION_MIN` | Minutos de vida de una compra abierta (120). |

Solo para pruebas locales, nunca en producción: `UCP_ALLOW_INSECURE_PROFILES=1` (acepta perfiles por http y en redes privadas) y `STRIPE_API_BASE` (apunta a un Stripe simulado).

Stripe: para que una compra nativa se confirme aunque se pierda la respuesta del cobro, agrega el evento `payment_intent.succeeded` al webhook existente.

Para vender dentro de Google hace falta, además del código: cuenta de Merchant Center, cuenta de Google Pay & Wallet Console, enviar el formulario de interés de UCP y que Google apruebe la integración. A la fecha (noviembre de 2026) Google no ha abierto la reserva de vuelos en AI Mode, y el formato del token de Google Pay con Stripe solo se puede comprobar en el ambiente de pruebas de Google.

Pruebas: `api/test/ucp.test.mjs` recorre los flujos con una plataforma y un Stripe simulados y valida las respuestas contra los esquemas oficiales (instrucciones al inicio del archivo).

## Clientes (CRM de pasajeros)

Pestaña «Clientes» del portal. Cada pasajero de cada reserva queda unido a una ficha (`crm_customers`, enlace en `crm_pax`); no hay que cargar nada a mano y las reservas anteriores se enlazan al arrancar.

- **Quién ve qué:** la agencia ve solo las fichas con reservas suyas, y de cada ficha solo sus reservas, sus notas y los datos de viaje que ella cargó (`/api/agency/crm`). El administrador ve todas, con filtro por agencia o venta directa (`/api/admin/crm?agency=<id>|web`). Las notas del administrador son internas.
- **Misma persona:** mismo nombre y mismo correo de contacto, o el mismo documento en otra reserva (así se unen las fichas de una persona que compra por dos agencias). Otro documento para la misma persona no crea otra ficha.
- **Datos de viaje:** documento, país, vencimiento, nacionalidad, nacimiento y género, por pasajero y reserva (`PUT /api/agency/bookings/:pnr/travel` y `/api/admin/...`). Se completan desde la ficha o desde el manifiesto; a un cliente que vuelve se le traen los de su última reserva con el mismo canal.
- **Datos de viaje, además:** teléfono y correo propios del pasajero, servicios especiales (silla de ruedas, menor sin acompañante, mascota en cabina, asistencia…) y, si lleva bebé en brazos, el nombre y el documento del bebé (obligatorios para darlos por completos; debe tener menos de 2 años el día del vuelo).
- **Manifiesto y entrega al operador** (Vuelos → Manifiesto, `GET /api/admin/manifest/control`):
  - *Cierre de ventas:* `close_hours` horas antes de la salida (3 por defecto, `PUT /api/admin/ops`) nadie puede reservar ni editar en ese vuelo, por ningún canal. Sale de `quote()`.
  - *Descarga:* CSV con los tiquetes emitidos, una fila por pasajero y otra por cada bebé, nombres en mayúsculas y sin tildes. El orden de columnas es provisional hasta tener la plantilla de carga masiva del operador (`manifestCsv` en `public/app.js`).
  - *Entregas:* «Registrar entrega al operador» guarda la foto de lo entregado (`manifest_sends`). Desde ahí el panel marca altas, cambios y bajas, y «Descargar solo novedades» entrega solo eso.
  - *Localizadores:* el código de cada reserva en el sistema del operador (`bookings.op_ref`), a mano en la tabla o pegando la lista (`POST /api/admin/manifest/refs`). El panel muestra cuántas reservas emitidas lo tienen: esa es la conciliación antes del vuelo.

Pruebas: `node --no-warnings api/test/crm.test.mjs` (levanta el servidor con una base temporal).

## Respaldos

La base de datos se copia sola: al arrancar (antes de que el código nuevo toque el esquema) y cada `BACKUP_EVERY_HOURS` (6 por defecto). Cada copia es una foto consistente (`VACUUM INTO`) que se abre y se revisa (integridad y número de reservas) antes de guardarla comprimida en `/data/backups`. Se conservan las 28 más recientes y una por día durante 30 días.

- **Portal:** pestaña Actividad → Respaldos: estado, «Crear copia ahora» y descarga (solo administradores con acceso completo). `GET /api/health` trae `backup.last` y `backup.ok`, para vigilarlo desde un monitor externo.
- **Fuera del servidor (opcional):** con `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_KEY` y `BACKUP_S3_SECRET` (y `BACKUP_S3_REGION`, `BACKUP_S3_PREFIX` si hacen falta) cada copia se sube a un almacenamiento compatible con S3 (Cloudflare R2, Backblaze B2, AWS S3). Con `BACKUP_PASSPHRASE` se sube cifrada (AES-256-GCM); sin esa clave no se puede abrir, así que hay que guardarla fuera del servidor.
- **Restaurar:** `node --no-warnings api/tools/restore.mjs <copia> <salida.db>` abre una copia (define `BACKUP_PASSPHRASE` si está cifrada), la revisa y dice cuántas reservas trae. Para ponerla en producción: detener `beemoapi`, reemplazar `/data/beemo.db` por la salida (borrar `beemo.db-wal` y `beemo.db-shm` si existen) e iniciar de nuevo.
- Los archivos de la carpeta de documentos (`/data/docs`) no van en estas copias; los cubre el respaldo semanal del VPS.

Pruebas: `node --no-warnings api/test/backup.test.mjs`.

## Reembolsos

Reservas → Reembolsos (administrador) y «Reembolso» en cada reserva emitida (agencia).

- **Causas:** `operacion` (Beemo Air canceló o cambió el vuelo: se sugiere el 100 % de lo pagado), `voluntaria` (el pasajero no viaja: porcentaje de la tarifa según la familia y la anticipación, más las tasas de los trayectos sin volar; los extras no) y `excepcion` (monto que fija el administrador, con o sin anular la reserva).
- **Política** (`GET`/`PUT /api/admin/refund-policy`): dos plazos (7 días y 24 horas por defecto) y tres porcentajes por familia. Ninguna tarifa puede devolver más que Flex BC en el mismo plazo, ni subir al acercarse el vuelo.
- **Flujo:** la agencia o el administrador abren la solicitud (`requested`); el administrador la aprueba (`approved`) con el monto sugerido o con otro, que exige motivo y nunca supera lo pagado; al aprobar se anula la reserva y se liberan las sillas; luego se marca `paid` con el medio y la referencia. También se puede rechazar con motivo.
- **Quién devuelve:** si la reserva se cobró en la agencia y no se ha consignado, devuelve la agencia y lo retenido entra a su saldo por consignar (`refund_retained_due` en el estado de cuenta) hasta marcarla pagada. En los demás casos devuelve Beemo Air; la devolución a tarjeta se hace en Stripe y aquí se anota la referencia.
- Lo retenido aún no entra al Tablero ni a Finanzas como ingreso; se ve en el total «retenido» de la bandeja.

Pruebas: `node --no-warnings api/test/refunds.test.mjs`.

## Operación irregular

La programación sale de `SCHED`; la tabla `flight_ops` la ajusta vuelo por vuelo. Todo se maneja desde Vuelos → Manifiesto del vuelo («Cambiar la operación de este vuelo») y «Agregar un vuelo» al pie de la lista.

- **Cancelar** (`POST /api/admin/flight/cancel`): el vuelo sale de la venta en todos los canales (`operates()` lo excluye) pero sigue visible para atender a sus pasajeros. Las reservas no se anulan. **Reabrir** lo devuelve a la venta.
- **Cambiar la hora** (`/retime`): guarda la hora nueva solo para esa fecha, la copia en cada reserva del vuelo y mueve el cierre de ventas (`depTime()` la usa).
- **Agregar un vuelo** (`/add`): una fecha fuera de la programación habitual, con la hora de siempre u otra.
- **Reacomodar** (`/move`): pasa el trayecto de una reserva, o de todas las del vuelo, a otra fecha de la misma ruta, sin costo. Conserva la silla si está libre; si no, asigna una de su cabina. No mueve una reserva si el regreso quedaría antes de la ida ni si tiene un reembolso en curso, y dice por qué.
- **Reembolsar** (`/refund`): abre el reembolso por causa de operación (100 % sugerido), que se aprueba en Reservas → Reembolsos. Una reserva apartada sin pago solo se libera.
- Cada cancelación, reapertura y cambio de hora deja un aviso para las agencias (`notices`). El portal no envía correos ni mensajes a los pasajeros: «Descargar contactos (CSV)» entrega la lista para avisarles.

Pruebas: `node --no-warnings api/test/irop.test.mjs`. Como toca la programación, conviene correr también las de UCP.

