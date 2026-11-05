# Taller Control

Aplicación para gestionar las seis secciones operativas: Panel general, Recepción, Inspección, Órdenes de servicio, Aprobación del cliente y Reportes y gastos. El modo de trabajo comparte los registros de todo el taller mediante un servidor dentro de la red local y SQLite; no usa Supabase, hosting permanente ni servicios de pago.

## Requisitos

- Node.js 22.13 o superior (se recomienda Node.js 24 LTS).
- Una computadora del taller que funcionará como servidor mientras se use la app.
- Los celulares y computadoras de los mecánicos conectados a la misma red privada del taller.

## Instalar y arrancar el taller

En la computadora que alojará la base de datos, abre una terminal en la carpeta del proyecto y ejecuta:

```bash
npm install
npm run manager:init
npm run local
```

`npm install` instala las dependencias locales del proyecto. Antes del primer arranque, `npm run manager:init` crea una sola vez la cuenta del encargado inicial: pide nombre y correo, y solicita una contraseña dos veces sin mostrarla mientras se escribe. La contraseña debe tener al menos 12 caracteres. Solo funciona si aún no existe un encargado; también admite una base previa que ya tenga técnicos. No crea órdenes ni gastos. Después, `npm run local` compila la app, arranca el servidor SQLite en el puerto 3000 y abre automáticamente `http://localhost:3000` en el navegador de esa computadora. El encargado inicia sesión y puede administrar las cuentas desde su perfil en la parte inferior izquierda. Si ya hay una sesión vigente, se reanuda sin volver a pedir la contraseña; las sesiones vencen a las 12 horas y también se pueden cerrar desde la app. La terminal muestra además las direcciones para que los demás dispositivos del taller entren, por ejemplo `http://192.168.1.20:3000`.

Si el navegador no se abre automáticamente, visita `http://localhost:3000` en la computadora del servidor o la dirección de red mostrada en la terminal desde otro dispositivo autorizado. En un equipo sin entorno gráfico, la apertura automática se puede desactivar con `TALLER_NO_OPEN_BROWSER=1`; el servidor seguirá mostrando las direcciones disponibles.

Si el firewall de la computadora lo solicita, permite el puerto TCP 3000 únicamente en la red privada del taller. No configures reenvío del puerto en el router ni exposición pública. Para dejar de compartir la app, detén el proceso con `Ctrl+C`.

## Administrar técnicos autorizados

No existe registro público. El encargado inicial también es un técnico autorizado y puede usar las seis secciones operativas. Una vez iniciada su sesión, abre el perfil de la parte inferior izquierda para agregar técnicos: captura su nombre, correo y una contraseña inicial de al menos 12 caracteres, y compártela con la persona por un canal privado. Desde esa misma pantalla puedes desactivar o reactivar las cuentas de los técnicos; la cuenta del encargado no se puede desactivar ahí. Desactivar a un técnico revoca sus sesiones activas, pero conserva sus registros históricos. Los técnicos no pueden administrar cuentas. La cuenta del encargado inicial se crea únicamente con `npm run manager:init`; cuando ya existe, ese comando no vuelve a funcionar.

## Datos y separación de la demo

El servidor guarda la base de datos en `data/taller-control.sqlite` y las fotografías en `data/evidence/`. La carpeta `data/` está excluida de Git. El almacenamiento empieza vacío y es compartido por los usuarios autorizados. No importa automáticamente los datos antiguos que quizá existan en el almacenamiento local de un navegador. Los registros inventados de la demo se mantienen separados y no se copian a la base real.

La demo ficticia se compila por separado con `npm run build:demo`; esa compilación es para mostrar el flujo con datos inventados y no debe usarse para manejar expedientes reales. Para preparar una prueba sin órdenes precargadas, `npm run build:test` crea almacenamiento de navegador aislado; no sustituye el servidor SQLite compartido.

## Respaldo y límites de red

No hay respaldo automático. Para respaldar los registros, detén el servidor con `Ctrl+C` y copia **toda** la carpeta `data/` a un medio seguro; incluye tanto el archivo SQLite como `evidence/`. No copies la base mientras el servidor sigue escribiendo. La recuperación requiere volver a colocar la carpeta completa en la computadora del servidor y arrancarlo de nuevo.

El servidor local usa HTTP, así que la conexión no cifra los datos entre dispositivos. Además de exigir una cuenta autorizada para consultar o cambiar registros, rechaza conexiones que no provengan de localhost o de rangos de red privada/local. Úsalo solo en una red confiable del taller; evita Wi‑Fi público o compartido y no configures reenvío del puerto hacia Internet. Antes de usar datos reales, valida las copias de respaldo, quién tiene acceso físico a la computadora y las reglas de privacidad y conservación de expedientes.

## Funciones conservadas

- Recepción, edición y borradores de órdenes.
- Inspección de kilometraje, combustible, condición, fluidos, accesorios, documentos, objetos declarados y fotos.
- Búsqueda, filtros, cambios de estado, vista imprimible/PDF y exportación CSV.
- Registro interno de solicitud y respuesta de aprobación; no envía mensajes ni crea una firma electrónica.
- Reporte de planeación y captura separada de gastos reales.
- PWA instalable; el service worker solo almacena recursos públicos de la interfaz y nunca guarda en caché las respuestas de la API o las fotos privadas.

El presupuesto de $43,395 MXN y el calendario de cinco semanas que aparecen en Reportes son supuestos de planeación del prototipo, no gastos reales ni una cotización aceptada.
