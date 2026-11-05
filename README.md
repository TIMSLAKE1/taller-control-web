# Taller Control

Aplicación para gestionar las seis secciones operativas: Panel general, Recepción, Inspección, Órdenes de servicio, Aprobación del cliente y Reportes y gastos. El modo de trabajo comparte los registros del taller mediante un servidor propio dentro de la red privada y SQLite local; no usa hosting, Supabase ni servicios de pago.

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

No existe registro público. El encargado inicial también es un técnico autorizado y puede usar las seis secciones operativas. Una vez iniciada su sesión, abre el perfil de la parte inferior izquierda para agregar técnicos: captura su nombre, correo y una contraseña inicial de al menos 12 caracteres, y compártela por un canal privado. Desde esa misma pantalla puedes desactivar o reactivar cuentas; desactivar una cuenta revoca sus sesiones activas y conserva sus registros históricos. Los técnicos no pueden administrar cuentas.

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
- Registro interno de solicitud y respuesta de aprobación; no envía mensajes ni crea una firma electrónica.
- Registro de gastos reales del taller, resumen por periodo, asociación opcional a una orden y exportación CSV.
- PWA instalable; el service worker solo almacena recursos públicos de la interfaz y nunca guarda en caché respuestas de la API ni fotos privadas.
