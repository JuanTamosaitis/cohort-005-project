# Proveedores de avisos in-app vs. tiempo real hecho en casa

Investigación para el ticket #2 (parte del mapa #1). Fuentes consultadas el 11 de noviembre de 2026. **Este documento no toma la decisión**: compara opciones y deja una recomendación argumentada; la decisión la toma el ticket de grilling (#3).

## Contexto de Cadence

- React Router 8.3.0 en modo framework, servido con `react-router-serve` (ver `package.json`).
- Un único proceso Node de larga duración y un único archivo SQLite vía Drizzle y `better-sqlite3` (ADR 0006). El ADR ya asume "una sola máquina, un solo escritor".
- Autenticación propia por cookie de sesión (`app/lib/session.ts`, `createCookieSessionStorage`, cookie `cadence_session`, `httpOnly`, `sameSite: lax`).
- Necesidad: avisos in-app en tiempo real para **Instructors** (comentarios nuevos en sus lecciones, respuestas en hilos) y **Students** (respuestas a sus comentarios), con bandeja persistente (entrega diferida si no están conectados, contador de no leídos) y estado de leído sincronizado entre pestañas y dispositivos. Email y push quedan fuera por ahora, pero no hay que cerrarles la puerta.

## Tabla comparativa

Precios: plan gratis / primer plan pago, según las páginas de precios oficiales consultadas hoy.

| Opción | Tiempo real | ¿Quién guarda la bandeja? | Sync de leído | Componente React | Auth del navegador | Gratis | Escala chica | Self-host / lock-in | Email/push después | Esfuerzo |
|---|---|---|---|---|---|---|---|---|---|---|
| **Knock** | Socket propio del servicio de tiempo real (transporte exacto no documentado en la página leída) | Knock | Sí, en el servidor de Knock; entre pestañas, `BroadcastChannel` experimental | Sí (`@knocklabs/react`), muy personalizable | JWT RS256 firmado por nuestro backend (`sub` = id de usuario) + "enhanced security mode" | 10.000 mensajes/mes | 250 USD/mes (50.000 mensajes) | No hay self-host; lock-in alto | Muy fácil (mismo workflow) | Bajo |
| **Novu Cloud** | WebSocket (`wss://…socket.novu.co`) | Novu | Sí, en tiempo real contra el backend de Novu | Sí (`@novu/react` `<Inbox />`), sub-componentes y hooks headless | HMAC-SHA256 del `subscriberId` con la secret key (`subscriberHash`) | 10.000 ejecuciones de workflow/mes, 24 h de activity feed | Pro desde 30 USD/mes (30.000 ejecuciones) | Núcleo MIT; self-host posible | Muy fácil | Bajo |
| **Novu self-host (Community)** | WebSocket (servicio WS propio) | Nosotros, en MongoDB | Igual que Cloud | Igual que Cloud (sin snooze, con marca Novu) | Igual que Cloud | Software gratis | Costo de infraestructura: API + Worker + WS + Dashboard, MongoDB, 2 Redis, S3 | Sin lock-in de vendor, pero mucha operación | Muy fácil | Alto (operación) |
| **Courier** | WebSocket (`inbox.listenForUpdates()`) | Courier | Sí, "instantáneo entre dispositivos" según Courier | Sí (`@trycourier/courier-react`), temas + `useCourier()` headless | JWT emitido por `POST /auth/issue-token` con scopes por usuario | 10.000 envíos/mes | 0,005 USD por envío (pago por uso) | Sin self-host; lock-in alto | Muy fácil | Bajo |
| **SuprSend** | WebSocket ("socket abierto") | SuprSend | Sí (seen/read/unread/archived vía API) | Sí (`@suprsend/react`), drop-in o headless (`@suprsend/react-core`) | JWT ES256 firmado por nuestro backend + enhanced security mode | 10.000 notificaciones/mes (con marca SuprSend) | 100 USD/mes (50.000) | Self-host solo en Enterprise | Muy fácil | Bajo |
| **MagicBell** | WebSocket (módulo Realtime del cliente JS) | MagicBell | Sí (no verifiqué el detalle) | Sí (`@magicbell/react`), CSS vars y componentes reemplazables | JWT HS256 firmado con la secret key del proyecto | 1.000 entregas/mes | 249 USD/mes (50.000) | Sin self-host | Fácil (incluye web push) | Bajo |
| **Pusher Channels** | WebSocket | **Nosotros** (Pusher no guarda historial) | La armamos nosotros | No | Endpoint nuestro que firma con HMAC-SHA256 (canales privados) | 200.000 mensajes/día, 100 conexiones | 49 USD/mes (500 conexiones) | Lock-in bajo (solo transporte) | Lo armamos nosotros (Beams aparte) | Medio |
| **Ably** | WebSocket | **Nosotros** (historial de 2 min, o persistido 24 h en Free) | La armamos nosotros | No (para notificaciones) | Token/JWT emitido por nuestro `authUrl` | 500 MAU; límites: 6 M mensajes/mes, 500 conexiones | Pro 29 USD/mes anual (1.000 MAU) | Lock-in bajo (solo transporte) | Lo armamos nosotros | Medio |
| **En casa (SQLite + SSE)** | Server-Sent Events desde una resource route | **Nosotros**, en `data.db` | Nosotros: escritura en SQLite + evento SSE a todas las conexiones del usuario | No; lo construimos con los componentes Radix que ya existen | La cookie de sesión existente (mismo origen) | Gratis | Gratis (mismo proceso) | Sin lock-in; los datos no salen | Hay que construir el envío (o enchufar un proveedor después) | Medio |

## Detalle por opción

### Knock

- **Precio**: Free 0 USD con hasta 10.000 mensajes; Starter 250 USD/mes con 50.000 mensajes y luego 0,005 USD c/u. Un "mensaje" es "a single message delivered to a single user on a single channel"; el ejemplo de la página indica que in-app + email cuentan como dos. En Free no hay corte duro: si pasás el límite sin medio de pago, te contactan. La página no menciona self-host. — https://knock.app/pricing
- **Auth**: el navegador usa la *public API key*; sin "enhanced security mode" esa clave puede actuar como cualquier usuario, por eso la doc pide activarlo antes de producción. Con el modo activo, nuestro backend firma un JWT **RS256** con la signing key (`sub` obligatorio, `iat`/`exp` recomendados; el helper `signUserToken` usa 3600 s por defecto) y se pasa como `userToken` a `KnockProvider`. Hay callback `onUserTokenExpiring` para renovar. — https://docs.knock.app/in-app-ui/security-and-authentication
- **Componente React**: `@knocklabs/react` con `KnockProvider`, `KnockFeedProvider`, `NotificationIconButton`, `NotificationFeedPopover`, `NotificationFeed`; personalización con `renderItem`, `renderHeader`, variables CSS `--rnf-*` o reemplazo total del CSS. Tiempo real "over a socket connection"; `auto_manage_socket_connection` desconecta pestañas inactivas; `__experimentalCrossBrowserUpdates` sincroniza pestañas con `BroadcastChannel` (experimental). Por defecto el badge cuenta *seen*, se puede cambiar a `unread`. Solo trae traducción `en`. — https://docs.knock.app/in-app-ui/react/feed
- **No verificado**: el protocolo exacto del socket de Knock.

### Novu (Cloud y self-host)

- **Precio Cloud**: Free 0 USD con 10.000 ejecuciones de workflow/mes, 5 workflows, 3 miembros, 24 h de retención del activity feed; Pro desde 30 USD/mes (30.000+); Team desde 250 USD/mes; excedente 1,20 USD por 1.000. Residencia de datos en EE. UU. o UE. El self-host "Enterprise" (on-prem con soporte) es a medida. — https://novu.co/pricing
- **Auth**: HMAC-SHA256 del `subscriberId` con la secret key, en hex; se pasa como `subscriberHash` a `<Inbox>`. Si HMAC está activo y falta el hash, el Inbox no carga. Para la región UE se configura `socketUrl: wss://eu.socket.novu.co`. — https://docs.novu.co/platform/inbox/prepare-for-production
  - Ojo: el hash HMAC no expira (depende solo del id), a diferencia de un JWT con `exp`. Es una inferencia del mecanismo descrito, no algo que la doc diga.
- **Componente**: `@novu/react` (React 18+, soporta React 19), contador de no leídos en la campana, marcar como leído sincroniza con el backend en tiempo real, tabs, filtros, panel de preferencias, localización, snooze; sub-componentes (Bell, Notifications, InboxContent, Preferences) y hooks headless. — https://docs.novu.co/platform/inbox/overview
- **Self-host Community**: núcleo con licencia MIT, carpeta `enterprise` con licencia comercial (https://github.com/novuhq/novu). Requiere servicios API, Worker, WS y Dashboard, MongoDB, **dos** clusters Redis (uno con AOF para colas) y almacenamiento de objetos; mínimo de una VM con 4 vCPU / 8 GB más Mongo y Redis (https://docs.novu.co/community/self-hosting-novu/overview). Sin snooze, sin quitar marca, sin SSO/RBAC, 1 miembro de equipo, sin tracking de actividad de email (https://docs.novu.co/community/self-hosted-and-novu-cloud). Para Cadence (un proceso + un archivo SQLite) es desproporcionado.

### Courier

- **Precio**: Developer gratis hasta 10.000 envíos/mes; Business 0,005 USD por envío; Enterprise a medida. La página no dice qué pasa al superar el límite gratis. — https://www.courier.com/pricing
- **Auth**: nuestro backend llama a `POST /auth/issue-token` con la API key y scopes (`user_id:<id>`, `inbox:read:messages`, `inbox:write:events`) y entrega el JWT al navegador, que hace `Courier.shared.signIn({ userId, jwt })`. `expires_in` es opcional (**sin él, el token no expira**); los SDK no renuevan solos. — https://www.courier.com/docs/platform/inbox/authentication
- **Componente**: `@trycourier/courier-react` (React 18+): `CourierInbox`, `CourierInboxPopupMenu`, `CourierToast`, `CourierPreferences`, temas y `useCourier()` headless. `inbox.listenForUpdates()` abre un WebSocket; sin esa llamada el inbox carga una sola vez. Solo render en cliente. — https://www.courier.com/docs/sdk-libraries/courier-react-web
- **Bandeja**: persistente; estados leído/abierto/archivado "update instantly across a user's signed-in devices"; contador de no leídos. — https://www.courier.com/docs/platform/inbox/inbox-overview
- **No verificado**: retención de mensajes del Inbox.

### SuprSend

- **Precio**: Free 10.000 notificaciones/mes (feed con marca SuprSend); Essentials 100 USD/mes (50.000, luego 2 USD por 1.000); Business 250 USD/mes; self-host solo en Enterprise. — https://www.suprsend.com/pricing
- **Auth**: public key + enhanced security mode; JWT **ES256** firmado en el backend con claims `entity_type: "subscriber"`, `entity_id`, `scope.tenant_id`, `exp`, `iat`; callback `refreshUserToken`. — https://docs.suprsend.com/docs/client-authentication
- **Componente**: `@suprsend/react` (drop-in) o `@suprsend/react-core` (headless); el antiguo `@suprsend/react-inbox` está fuera de soporte. — https://docs.suprsend.com/docs/inbox-react. Según la doc de Inbox, el componente maneja el WebSocket, el contador de no leídos y marca "seen" al entrar en pantalla (desactivable); el feed expone `markAsRead`, `markAllAsRead`, `resetBadgeCount`, etc. — https://docs.suprsend.com/docs/inbox-quick-start, https://docs.suprsend.com/docs/js-inapp-feed (resumen obtenido vía buscador; no leí cada página completa).

### MagicBell

- **Precio**: Builder 0 USD con **1.000** entregas/mes; Startup 249 USD/mes (50.000, luego 0,0025 USD). Cada canal cuenta como una entrega aparte. — https://www.magicbell.com/pricing
- **Auth**: JWT **HS256** firmado con la secret key del proyecto, claims `user_external_id` y/o `user_email` y `api_key`; los ejemplos usan expiración de 1 año. — https://www.magicbell.com/docs/api/authentication/user
- **Componente**: `@magicbell/react` con `ContextProvider` (prop `token`), `FloatingInbox`, `Inbox`, `ToastContainer`, `UserPreferences`, `WebPushButton`; variables CSS y componentes reemplazables. — https://www.magicbell.com/docs/libraries/react. Tiempo real por WebSocket según la doc del cliente JS (https://www.magicbell.com/docs/libraries/magicbell-js, vía buscador). Contador: `GET /notifications/unread/count`.
- **No verificado**: sincronización de leído entre dispositivos (asumible, no confirmada).

### Pusher Channels (solo transporte)

- **Precio**: Sandbox gratis 200.000 mensajes/día y 100 conexiones concurrentes; Startup 49 USD/mes (1 M/día, 500 conexiones). — https://pusher.com/channels/pricing/
- **Auth**: para canales privados, el cliente pide a **nuestro** endpoint (con la cookie de sesión) una firma HMAC-SHA256 hecha con el secret de Channels. — https://pusher.com/docs/channels/server_api/authorizing-users/, https://pusher.com/docs/channels/library_auth_reference/auth-signatures/
- **Bandeja**: Channels "does not offer any message history functionality out of the box"; sin Cache Channels no se guarda nada del evento. — https://docs.bird.com/pusher/channels/channels/events/does-channels-store-a-history-of-events-and-messages (la doc de Pusher se movió a docs.bird.com). Igual tenemos que construir tabla, contador, leído y UI: Pusher solo reemplaza la parte SSE del hecho en casa.

### Ably (solo transporte)

- **Precio**: ahora por MAU: Free 500 MAU; Pro 29 USD/mes anual (35 mensual) por 1.000 MAU; Business 349 USD/mes; excedente 0,05 USD por MAU. — https://ably.com/pricing, https://ably.com/docs/platform/pricing. Límites del Free: 6.000.000 mensajes/mes, 500 conexiones y 500 canales concurrentes. — https://ably.com/docs/platform/pricing/limits
- **Auth**: el SDK pide un token a nuestro `authUrl`/`authCallback`; recomiendan JWT firmado con el secreto de la API key, con capabilities y `clientId`; TTL máximo 24 h, renovación automática. — https://ably.com/docs/auth/token
- **Bandeja**: guarda mensajes 2 minutos por defecto; historial persistido 24 h en Free (hasta 365 días en Pro, con costo); no hay API para borrar mensajes persistidos. No sirve como bandeja; igual necesitamos nuestra tabla. — https://ably.com/docs/storage-history/storage

### Hecho en casa: tabla SQLite + SSE desde una resource route

Diseño mínimo:

1. Tabla `notification` en `app/db/schema.ts` (destinatario, tipo, referencia a comentario/lección, `createdAt`, `readAt`). La bandeja persistente y la entrega diferida salen gratis: el usuario la ve al volver.
2. Al crear un comentario/respuesta, se insertan las filas en la misma transacción y se emite el evento en un `EventEmitter` en memoria indexado por `userId`. Es válido **porque hay un solo proceso** (ADR 0006); si algún día hay varios, hace falta un fan-out (Redis pub/sub, Postgres `LISTEN/NOTIFY` o un transporte como Pusher/Ably).
3. Resource route (módulo con `loader` y sin componente por defecto, https://reactrouter.com/how-to/resource-routes) que lee la sesión con `getCurrentUserId(request)`, devuelve `new Response(readableStream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } })` y se desuscribe en `request.signal` `abort`. La doc de resource routes muestra loaders que devuelven `Response` con cuerpo propio; que el cuerpo sea un `ReadableStream` es Fetch estándar, no algo que esa página diga explícitamente.
4. "Marcar como leído" es una `action` que actualiza `readAt` y emite un evento `read` al mismo usuario: así se sincronizan **todas** sus pestañas y dispositivos conectados, y el resto lo ve al recargar (el contador sale de SQLite).

Trampas verificadas:

- **Compresión en `react-router-serve`**: `@react-router/serve` 8.3.0 hace `app.use(compression())` a todas las respuestas (`node_modules/@react-router/serve/dist/cli.js`, línea 113), y `text/event-stream` es comprimible según `compressible`. La compresión acumula salida y retrasa los eventos. El middleware `compression` 1.8.2 **no comprime si la respuesta trae `Cache-Control: no-transform`** (`node_modules/compression/index.js`, `shouldTransform`). Solución: mandar siempre ese header, o pasar a un servidor Express propio con `@react-router/express` y excluir la ruta. Verificado leyendo el código fuente instalado.
- **Proxies**: proxies viejos cortan conexiones HTTP ociosas; la spec recomienda un comentario (`:`) "every 15 seconds or so" (https://html.spec.whatwg.org/multipage/server-sent-events.html §9.2.7). Detrás de nginx hay que desactivar el buffering (por ejemplo `X-Accel-Buffering: no`; fuente secundaria, https://www.svix.com/resources/guides/server-sent-events-express/). En Cloudflare (el código ya lee `CF-IPCountry`) conviene probar que el stream no se bufferee; **no verificado**.
- **Varias pestañas**: sobre HTTP/1.1 el navegador permite solo **6 conexiones por navegador + dominio**, sumando todas las pestañas; con HTTP/2 se negocian (por defecto 100). — https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events. `react-router-serve` habla HTTP/1.1, así que con 6+ pestañas abiertas el sitio se cuelga si no hay un proxy HTTP/2 delante o si no se comparte una sola conexión entre pestañas (una pestaña "líder" con Web Locks reenviando por `BroadcastChannel`, que está disponible en todos los navegadores modernos desde marzo de 2022: https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel).
- **Reconexión**: `EventSource` reconecta solo; el servidor puede ajustar la espera con `retry:` y, si mandamos `id:`, el navegador reenvía `Last-Event-ID` al reconectar (spec §9.2.4). Como la fuente de verdad es SQLite, lo más simple es que al (re)conectar el cliente pida de nuevo contador y lista, en vez de reproducir eventos.
- **Dev vs. producción**: en `react-router dev` (Vite) el servidor es otro; hay que probar el stream en ambos modos. **No verificado**.
- **Una conexión abierta por pestaña** en el proceso Node: barato a esta escala, pero hay que limpiar en `abort` para no filtrar listeners.

Testabilidad: es la mejor de todas. La lógica (quién recibe qué aviso, contador, marcar leído) son funciones sobre SQLite que se prueban con Vitest como el resto del repo, sin mocks de terceros; la resource route se puede probar llamando al `loader` con un `Request` y leyendo el stream.

## Recomendación (no es la decisión)

**Recomendación: hacerlo en casa (tabla SQLite + SSE desde una resource route), diseñando el modelo de avisos como un módulo propio para poder enchufar un proveedor más adelante.** Como alternativa, si el grilling prioriza tiempo de salida y UI ya hecha sobre privacidad y dependencias: **Knock** (JWT RS256 con expiración, el componente más maduro y personalizable) o **Novu Cloud** (núcleo MIT y salida a self-host, pero auth HMAC sin expiración).

Argumentos:

1. **Encaja con la arquitectura que ya decidimos.** ADR 0006 fija un proceso y un archivo SQLite: un `EventEmitter` en memoria alcanza para el fan-out y la bandeja vive junto a comentarios y lecciones, consultable con Drizzle de forma síncrona. Los proveedores obligan a duplicar usuarios ("subscribers") y a sincronizarlos con un tercero.
2. **La auth es trivial.** El `EventSource` es del mismo origen y manda la cookie `cadence_session`; no hay que firmar JWT ni manejar renovación. Con un proveedor sumamos una clave de firma, un endpoint para emitir tokens y su expiración (o, con Novu/Courier/MagicBell, tokens que no expiran o duran un año por defecto).
3. **El alcance es chico.** Tres tipos de aviso, solo in-app. Lo que más aportan los proveedores (orquestación multicanal, digest, preferencias, plantillas de email) es justamente lo que queda fuera por ahora.
4. **Costo y privacidad.** Los free tiers (10.000 mensajes en Knock, Courier y SuprSend; 1.000 en MagicBell) alcanzan para empezar, pero el primer escalón pago es de 100-250 USD/mes (salvo Novu Pro, desde 30 USD) y el contenido de comentarios de alumnos saldría a un tercero.
5. **Pusher/Ably no ahorran lo difícil.** Solo reemplazan el transporte; bandeja, contador, leído y UI siguen siendo nuestros. Tienen sentido solo si algún día hay varios procesos.
6. **Testabilidad.** Todo queda dentro de Vitest y SQLite, como el resto del repo.

Costos y riesgos de la recomendación, para el grilling:

- Hay que construir y mantener la UI de la bandeja (campana, popover, lista, marcar todo como leído).
- Hay que resolver las trampas de SSE: `Cache-Control: no-transform` por la compresión de `react-router-serve`, heartbeat cada ~15 s, límite de 6 conexiones en HTTP/1.1 (una conexión compartida entre pestañas o HTTP/2 delante) y limpieza de listeners.
- Email/push más adelante: o los construimos (cola, plantillas, preferencias), o en ese momento enchufamos un proveedor detrás del módulo de avisos. Si el modelo está aislado (un único punto "notificar a X sobre Y"), migrar a Knock/Novu después es acotado.
- Si Cadence pasa a varias instancias, el `EventEmitter` en memoria deja de alcanzar, pero ADR 0006 ya descarta ese escenario por ahora.

## Lo que no pude verificar

- El protocolo exacto del tiempo real de Knock (la doc dice "socket" y "real-time service").
- La retención de mensajes de Courier Inbox y de Knock.
- La sincronización de leído entre dispositivos en MagicBell (la página leída no lo dice).
- Qué pasa al superar el límite gratis de Courier y MagicBell (las respuestas del FAQ no estaban en el contenido).
- Algunos detalles de SuprSend y MagicBell (WebSocket, seen tracking, contador) salen de resúmenes de buscador restringidos a sus dominios oficiales, no de leer cada página completa.
- El comportamiento del stream SSE detrás de Cloudflare y en `react-router dev` (Vite); hay que probarlo con un prototipo.
