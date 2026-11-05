# Taller Control

Aplicación web adaptable al celular para gestionar recepción de vehículos, inspección, órdenes imprimibles, autorizaciones internas y gastos. Conserva las seis secciones operativas: Panel general, Recepción, Inspección, Órdenes de servicio, Aprobación del cliente y Reportes y gastos. Incluye instalación como PWA.

## Ejecutar la aplicación operativa

Requiere Node.js 20 o superior y npm.

```bash
npm install
npm run dev
```

Sin credenciales Supabase, la app trabaja en modo local y comienza sin órdenes ni gastos. Recepciones, inspecciones, estados, gastos y fotos se guardan en el navegador de este dispositivo; no hay sincronización entre dispositivos ni servidor. El modo local no requiere un servicio de pago. Las órdenes y gastos se pueden exportar desde sus secciones como CSV; las fotos permanecen en el navegador.

Para generar los archivos de producción:

```bash
npm run build
npm run preview
```

## Demo pública sin backend

Para generar la versión destinada a una publicación pública ficticia, ejecuta:

```bash
npm run build:demo
```

Este modo fuerza el almacenamiento en el navegador aunque existan variables Supabase en el entorno y evita inicializar el cliente remoto. Empieza con un solo registro ficticio (Diana Ejemplo, Volkswagen Jetta, TEST-001), separado de los datos operativos. Publica únicamente el contenido de `dist/`; no agregues funciones de servidor ni credenciales. Cada visitante tendrá su propio registro ficticio y los cambios quedarán en su navegador.

En un proveedor como Cloudflare Pages, mantén el proyecto en el plan gratuito y publica solo archivos estáticos: Cloudflare indica que las solicitudes a recursos estáticos no tienen costo ni límite de uso; Pages Functions, en cambio, cuentan como solicitudes de Workers. El plan gratuito limita los builds a 500 por mes. Sus alertas de presupuesto son informativas, no pausan ni limitan el gasto, así que no habilites Workers de pago, Functions, KV, R2 ni otros productos facturables para esta demo. No hay un proveedor de hosting vinculado a este repositorio todavía, por lo que la alerta de cuenta no se puede configurar desde el proyecto.

## Funciones implementadas

- Alta, edición y borradores locales de recepción, cliente, vehículo, motivo, falla y responsable.
- Inspección de kilometraje, combustible, condición física, fluidos, accesorios, documentos, objetos declarados y fotos de evidencia.
- Búsqueda, filtros por estado/motivo, avance de estados con validaciones, apertura de expedientes y exportación CSV.
- Hoja de recepción imprimible o guardable como PDF.
- Registro interno de solicitud, aprobación o cambios; no envía mensajes ni afirma que exista firma electrónica.
- Reporte de presupuesto/plan de cinco semanas del prototipo y captura separada de gastos reales del taller.
- Modo local persistente y sin costo de servidor. Supabase sigue siendo una integración opcional no configurada; no la actives si no puedes garantizar un costo de $0.
- PWA instalable; el modo local mantiene sus datos en este navegador.

## Integración cloud opcional (no activada)

No hay un proyecto Supabase conectado y la app local no lo necesita. Esta integración no se activó en este trabajo. Configúrala solo si puedes verificar que el plan y el uso tendrán un costo de $0, sin habilitar ni aceptar cargos; si no se puede confirmar, continúa en modo local y no la conectes. Para enlazarla en el futuro, aplica `supabase/migrations/20261104180000_initial_schema.sql`. El proyecto incorpora Auth, talleres y membresías, clientes, vehículos, órdenes, gastos, eventos y un bucket privado para evidencia; las políticas RLS aíslan los datos por taller.

Después copia la URL del proyecto y su clave **publishable/anon** a `.env.local` (nunca uses una clave `service_role` en el navegador):

```env
VITE_SUPABASE_URL=https://TU-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_TU_CLAVE
```

Reinicia Vite después de modificar variables. Inicia sesión/crea una cuenta y registra el nombre del taller. Si la primera cuenta requiere confirmar correo, completa la confirmación antes de iniciar sesión. Los datos ficticios de modo local no se copian a Supabase.

## Notas de operación y seguridad

- La aprobación se registra como constancia interna. No se conecta con WhatsApp, correo ni un proveedor de firma; confirma por separado los requisitos legales y el mecanismo adecuado antes de usarla como consentimiento.
- Los archivos de evidencia quedan en el bucket privado al usar Supabase. En modo local se conservan en IndexedDB del mismo navegador.
- No se almacenan secretos en el repositorio. `.env.local` está excluido por `.gitignore`.
- Para publicar solo la demo ficticia, usa `npm run build:demo`; el build normal puede conectarse a Supabase si se configuran credenciales.
- El presupuesto de $43,395 MXN y el cronograma de cinco semanas se conservan como supuestos de planeación del prototipo, no como gastos reales ni una cotización aceptada.
