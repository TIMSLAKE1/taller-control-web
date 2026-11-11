# Pendientes antes del uso con datos reales

## 1. Probar los flujos operativos

- Validar en celular y computadora la recepción, borradores, inspección, fotos, cambios de estado, PDF, aprobación, gastos, filtros y exportación CSV. En aprobación, confirmar que correo/WhatsApp solo preparan el mensaje, que el envío exige una acción manual y que fechas y respuestas quedan guardadas en SQLite local. En gastos, validar la carga, consulta y eliminación de la imagen del justificante.
- La suite automatizada cubre generación de borradores y reglas clave, pero no toda la interfaz; ampliar pruebas según se validen dispositivos reales.
- Confirmar que exista un solo encargado inicial, que las demás cuentas correspondan únicamente a técnicos autorizados y que cada persona use su propia contraseña.

## 2. Respaldar y recuperar SQLite

- La base y las fotografías compartidas viven en `data/` en la computadora del taller. No hay respaldo automático ni sincronización fuera de esa computadora.
- Probar el respaldo completo de `data/` con el servidor detenido, y ensayar la recuperación antes de usar estos datos como único expediente.
- Definir quién puede acceder físicamente a la computadora, a la carpeta `data/` y a los medios de respaldo.

## 3. Configurar la red del taller

- El servidor ahora admite HTTPS local mediante `TALLER_TLS_CERT` y `TALLER_TLS_KEY`; antes de usar datos reales, aprovisionar un certificado cuyo nombre o IP coincida con la dirección del servidor e instalar su autoridad certificadora como confiable en todos los dispositivos cliente. La guía está en `README.md`.
- Hasta que todos los dispositivos validen el certificado, limitar el acceso a una red privada y confiable, con firewall restringido al perfil privado y a la subred del taller. No abrir ni reenviar el puerto 3000 a Internet.
- Revisar reglas de firewall, actualizaciones del sistema y la política de conservación de datos personales del taller.

## 4. Acordar el alcance operativo pendiente

- El correo (`mailto`), WhatsApp (`wa.me`) y portal/otro se preparan sin APIs ni cargos; el envío y la revisión del mensaje son manuales. Acordar el canal con el cliente y validar la política de privacidad del taller. El registro de respuesta es interno y no constituye una firma electrónica ni determina validez legal.
- La aplicación no se configura para iniciar automáticamente ni para alojarse permanentemente. Si más adelante se requiere arranque automático, definir primero responsable, mantenimiento, respaldo y controles de acceso del equipo.

## Límites deliberados de esta versión

El modo predeterminado sigue usando Node.js y SQLite local. También existe una compilación estática opcional para Supabase Free; no reemplaza ni migra SQLite. Las órdenes, gastos y perfiles del esquema Supabase empiezan vacíos. La demo ficticia y la prueba limpia son compilaciones separadas que no leen ni escriben la base operativa.

## 5. Completar y verificar la alternativa gratuita en línea

- La arquitectura aprobada es Cloudflare Pages Free + Supabase Free. El proyecto Supabase recién creado tenía el esquema vacío; ya se aplicó el esquema inicial y una migración de seguridad. Las siete tablas están vacías; bucket `taller-evidencia` privado. La instalación SQLite sigue operativa y no se modificó `data/`.
- El modo estático de Supabase ya está implementado en código (`npm run build:cloud`), con Auth, RLS, las seis secciones, cuentas autorizadas/invitaciones, gastos, órdenes y evidencia privada. Las 11 pruebas automatizadas y las compilaciones cloud, SQLite, prueba limpia y demo pasaron; faltan pruebas funcionales con sesión real y en celular/computadora. No publicar hasta completarlas.
- El correo de bootstrap del primer encargado ya está configurado exclusivamente en el esquema privado de Supabase; no incluirlo en el repositorio ni en documentación pública. Todavía no existe la cuenta del encargado: queda pendiente que su titular se registre con ese correo y confirme la dirección desde el mensaje de Supabase.
- Para Pages, quedan pendientes configurar el proyecto estático con `npm install`, `npm run build:cloud`, directorio `dist`, `VITE_SUPABASE_URL` y la llave publicable; registrar el dominio de Pages como URL permitida de Auth y validar confirmación de correo. No compartir ni subir una llave `service_role` o secretos. Aún no hay despliegue, configuración de Pages ni cambios DNS.
- El cliente presenta aviso de evidencia desde 70% y bloquea cargas al límite interno de 700 MiB; el límite de cada imagen es 10 MB. Esto no es alerta de facturación ni mide cuotas completas de proveedores. Mantener Free, sin medio de pago, upgrades ni Workers/Functions/R2; Pages Free tiene 500 builds al mes, y las alertas de presupuesto de Cloudflare exigen Pay-as-you-go y no bloquean cargos.
- Revisar plan/uso manualmente; Supabase Free puede restringir el servicio al exceder límites aunque no cobre excesos. Antes de migrar cualquier dato operativo, respaldar `data/` y solicitar autorización explícita. Nunca reemplazar SQLite local ni cambiar DNS sin confirmación.
