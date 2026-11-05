# Taller Control

Aplicación web adaptable al celular para gestionar recepción de vehículos, inspección, órdenes imprimibles, autorizaciones internas y gastos. Conserva las seis secciones del prototipo: Panel general, Recepción, Inspección, Órdenes de servicio, Aprobación del cliente y Reportes y gastos. Incluye instalación como PWA.

## Ejecutar para revisar

Requiere Node.js 20 o superior y npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Sin credenciales Supabase, la app trabaja en modo local y crea **un solo registro ficticio de prueba** (Diana Ejemplo, Volkswagen Jetta, TEST-001). Los cambios que hagas en este modo se guardan en este navegador. No se mezclan con datos reales ni se suben a la nube. Puedes borrar la prueba desde el botón «Restablecer prueba» del panel general.

Para generar los archivos de producción:

```bash
npm run build
npm run preview
```

## Funciones implementadas

- Alta y edición de recepción, cliente, vehículo, motivo, falla y responsable; borradores guardados.
- Inspección de kilometraje, combustible, condición física, fluidos, accesorios, documentos, objetos declarados y fotos de evidencia.
- Búsqueda, filtros por estado/motivo, apertura de expedientes y exportación CSV.
- Hoja de recepción imprimible o guardable como PDF.
- Registro interno de solicitud, aprobación o cambios; no envía mensajes ni afirma que exista firma electrónica.
- Reporte de presupuesto/plan de cinco semanas del prototipo y captura separada de gastos reales del taller.
- Modo local persistente, conexión Supabase opcional, acceso con Supabase Auth y aislamiento por taller con políticas RLS.
- PWA instalable; el modo local mantiene sus datos en este navegador.

## Activar Supabase

No hay un proyecto Supabase conectado todavía. Para enlazar uno, primero crea o selecciona un proyecto en la organización de tu cuenta y aplica `supabase/migrations/20261104180000_initial_schema.sql`. El proyecto incorpora Auth, talleres y membresías, clientes, vehículos, órdenes, gastos, eventos y un bucket privado para evidencia; las políticas RLS aíslan los datos por taller.

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
- El presupuesto de $43,395 MXN y el cronograma de cinco semanas se conservan como supuestos de planeación del prototipo, no como gastos reales ni una cotización aceptada.
