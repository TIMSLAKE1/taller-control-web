# Taller Control

Aplicación para gestionar las seis secciones operativas: Panel general, Recepción, Inspección, Órdenes de servicio, Aprobación del cliente y Reportes y gastos. El modo predeterminado conserva el servidor Node.js y SQLite local. Existe además una compilación estática opcional para Cloudflare Pages Free + Supabase Free; no reemplaza ni migra la instalación SQLite.

## Requisitos

- Node.js 22.13 o superior (se recomienda Node.js 24 LTS).
- Una computadora del taller que funcionará como servidor mientras se use la app.
- Los celulares y computadoras de los mecánicos conectados a la misma red privada y confiable del taller.

## Instalar y arrancar

En la computadora que alojará la base de datos, abre una terminal en la carpeta del proyecto y ejecuta:

```bash
npm install
npm run manager:init
npm run local
```

`npm install` instala las dependencias locales. Antes del primer arranque, `npm run manager:init` crea una sola vez la cuenta del encargado inicial: pide correo, nombre y una contraseña dos veces sin mostrarla mientras se escribe. Usa una contraseña única de al menos 12 caracteres. La base de datos se inicializa después de capturar las respuestas para que el aviso informativo de SQLite de Node.js no aparezca junto al campo del correo: ese aviso no es el correo ni debes escribirlo. No crea órdenes ni gastos. Si ya hay una cuenta de encargado, el comando no vuelve a funcionar.

`npm run local` compila la interfaz y arranca el servidor SQLite en el puerto 3000. Por defecto abre `http://localhost:3000` en la computadora del servidor y muestra las direcciones LAN, por ejemplo `http://192.168.1.20:3000`, para los demás dispositivos autorizados. El encargado inicia sesión y administra las cuentas desde su perfil en la app. Si no se abre el navegador, visita una de las direcciones que muestra la terminal. Para no abrirlo automáticamente, define `TALLER_NO_OPEN_BROWSER=1` antes de iniciar.

El servidor debe permanecer encendido mientras se use la app. Para detenerlo, pulsa `Ctrl+C` en su terminal. Si el firewall pregunta, permite el puerto TCP 3000 únicamente en el perfil privado y para la subred local del taller; no habilites el perfil público. No configures reenvío de puertos en el router ni expongas el servidor directamente a Internet.

## Cifrado HTTPS dentro del taller (recomendado antes de usar datos reales)

El arranque normal por HTTP no cifra las contraseñas ni los datos mientras viajan por la red local. Para evitarlo, Taller Control admite un certificado TLS local, sin añadir servicios de pago. El certificado debe incluir el nombre o la dirección IP con que entrarán los celulares y computadoras, y su autoridad certificadora debe estar instalada como confiable tanto en el servidor como en cada dispositivo cliente. Reserva la dirección LAN de la computadora del servidor en el router para que no cambie. No compartas la clave privada del certificado.

Guarda los archivos de certificado y clave en una carpeta local `certs/` (está excluida de Git). Con un certificado ya confiable para todos los dispositivos, inicia así:

En PowerShell:

```powershell
$env:TALLER_TLS_CERT = (Resolve-Path .\certs\taller.pem).Path
$env:TALLER_TLS_KEY = (Resolve-Path .\certs\taller-key.pem).Path
npm run local
```

En Linux o macOS:

```bash
TALLER_TLS_CERT=./certs/taller.pem TALLER_TLS_KEY=./certs/taller-key.pem npm run local
```

La terminal mostrará direcciones `https://...`; usa esas direcciones en todos los dispositivos y no ignores advertencias del navegador. Si solo se configura una de las dos variables, o el certificado no es válido, el servidor no inicia. Con HTTPS, las cookies de sesión llevan el atributo `Secure`; también se activa HSTS. Sin HTTPS, el servidor muestra un aviso explícito.

Si aún no es posible instalar y verificar el certificado en cada dispositivo, mantén el uso limitado a una red privada del taller con contraseña Wi‑Fi fuerte, equipos confiables y acceso de invitados desactivado. No uses Wi‑Fi público o compartido ni cargues información sensible por HTTP. El filtro de direcciones privadas del servidor no sustituye el firewall: cualquier dispositivo que ya esté en la red del taller podría alcanzar la pantalla de inicio de sesión.

## Administrar técnicos autorizados

No existe registro público. El encargado inicial también es un técnico autorizado y puede usar las seis secciones operativas. En la versión SQLite, abre el perfil de la parte inferior izquierda para agregar técnicos: captura su nombre, correo y una contraseña inicial de al menos 12 caracteres, y compártela por un canal privado. Desde esa misma pantalla puedes desactivar o reactivar cuentas; desactivar una cuenta revoca sus sesiones activas y conserva sus registros históricos. Los técnicos no pueden administrar cuentas.

En la versión cloud, únicamente el encargado activo puede agregar técnicos desde Administración de usuarios. El encargado define la contraseña inicial y confirma el correo por acción administrativa; Supabase no envía un correo de confirmación. Antes de agregar una cuenta, verifica que la dirección pertenezca al técnico y comparte la contraseña inicial por un canal privado. La creación la realiza la función Edge `create-technician` del lado servidor, con JWT obligatorio y control de rol; la clave privilegiada nunca se incluye en el navegador. Si una cuenta existente está desactivada, reactívala en vez de crear otra.

## Datos, pruebas y demo

El servidor guarda la base de datos en `data/taller-control.sqlite` y las fotografías en `data/evidence/`. La carpeta `data/` está excluida de Git. La base inicia vacía y es compartida por los usuarios autorizados; no importa automáticamente los datos que quizá existan en el almacenamiento local de un navegador.

La demo ficticia se compila por separado con `npm run build:demo`; no debe usarse con expedientes reales. Para una prueba sin órdenes precargadas, `npm run build:test` crea almacenamiento de navegador aislado; no sustituye el servidor SQLite compartido. Los registros inventados de la demo no se copian a la base operativa.

## Respaldos y acceso remoto

No hay respaldo automático. Para respaldar, detén el servidor con `Ctrl+C` y copia **toda** la carpeta `data/` a un medio seguro; incluye la base SQLite y `evidence/`. No copies la base mientras el servidor sigue escribiendo. Ensaya la recuperación antes de depender de estos registros.

Esta instalación está diseñada para funcionar en la red privada del taller. El acceso desde fuera de esa red no está habilitado ni garantizado: dependería de la configuración del router y del proveedor de Internet. No abras ni reenvíes el puerto 3000 a Internet. Si se necesita acceso remoto más adelante, debe diseñarse con una VPN de código abierto administrada por el taller y revisarse la conectividad disponible; no basta con publicar el puerto.

## Funciones conservadas

- Recepción, edición y borradores de órdenes.
- Inspección de kilometraje, combustible, condición, fluidos, accesorios, documentos, objetos declarados y fotos.
- Búsqueda, filtros, cambios de estado, vista imprimible/PDF y exportación CSV.
- Aprobación sin cargos de servicios externos: prepara un borrador de correo (`mailto`), abre WhatsApp con texto prellenado (`wa.me`) o copia el texto para un portal/otro canal. El taller revisa y envía manualmente; la app registra la solicitud, el resultado, fecha y nota de respuesta en el backend activo (SQLite local o Supabase). No usa APIs de envío ni crea una firma electrónica.
- Registro de gastos reales del taller, resumen por periodo, asociación opcional a una orden, exportación CSV e imagen opcional de factura/justificante guardada en el backend activo (archivos locales o bucket privado en Supabase).
- PWA instalable; el service worker solo almacena recursos públicos de la interfaz y nunca guarda en caché respuestas de la API ni fotos privadas.

## Alternativa en línea: Cloudflare Pages Free + Supabase Free

Para compilar el modo estático, configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` con valores públicos del proyecto y ejecuta `npm run build:cloud`; el resultado es `dist/`. Cloudflare Pages usa `npm install`, `npm run build:cloud` y la carpeta de salida `dist`. El archivo `public/_headers` aplica CSP y encabezados básicos de seguridad. La administración de técnicos usa una función Edge de Supabase Free; no se usan Pages Functions/Workers ni R2. La función exige JWT, verifica que la sesión pertenezca a un encargado activo y usa `SUPABASE_SERVICE_ROLE_KEY` únicamente en el servidor. La llave publicable queda visible en el navegador por diseño; su seguridad depende de RLS y no debe confundirse con una llave secreta. El `.env.example` solo contiene marcadores, nunca credenciales.

El proyecto Supabase `Taller Control` está en una organización Free. El esquema y las políticas de seguridad ya están aplicados; las tablas operativas de órdenes, gastos, eventos y evidencia se mantienen vacías, mientras la cuenta del encargado existente permanece activa. El bucket `taller-evidencia` es privado. No existe registro público. Las altas de técnicos pasan por `create-technician`: guarda un token aleatorio de invitación en forma hash, crea la cuenta solo después de verificar el JWT y el rol del encargado, y marca el correo confirmado sin enviar un mensaje. El encargado debe verificar la dirección y compartir la contraseña inicial por un canal privado. SQLite local sigue intacta y no se importa ni migra `data/`.

La versión en línea conserva las seis secciones operativas, registro de órdenes/gastos, aprobación manual, administración de cuentas y evidencia privada. Cada imagen tiene tope de 10 MB y la aplicación impone un límite interno de evidencia de 700 MiB: muestra un aviso desde 70% y rechaza nuevas cargas al llegar al tope. Ese indicador solo mide evidencia de la app; no es un monitor de facturación ni detecta el consumo total del proveedor.

El objetivo es permanecer en **$0**: mantener ambos servicios en Free; la cuota de Edge Functions del plan Free incluye 500,000 invocaciones mensuales. No añadir medios de pago, upgrades ni complementos, y no cambiar DNS. Cloudflare Pages Free tiene límite de 500 builds mensuales. Las alertas de presupuesto de Cloudflare requieren Pay-as-you-go y no bloquean gasto, por lo que no se habilitarán. El uso gratuito puede estar sujeto a límites o restricciones del proveedor; no se debe mejorar el plan automáticamente ([control de costos y cuotas de Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase), [límites de Pages](https://developers.cloudflare.com/pages/platform/limits/), [alertas de presupuesto](https://developers.cloudflare.com/billing/manage/budget-alerts/)). Revisa manualmente el plan y uso desde los paneles.

**Estado:** la aplicación está publicada en `https://taller-control-web.pages.dev` y Pages despliega desde `main`. La función `create-technician` está activa en Supabase con verificación JWT obligatoria; una llamada sin sesión fue rechazada con HTTP 401. El encargado inicial ya pudo iniciar sesión. Esta implementación no creó ni modificó cuentas reales, órdenes, gastos ni archivos de evidencia. SQLite local, la demo y sus datos permanecen separados.
