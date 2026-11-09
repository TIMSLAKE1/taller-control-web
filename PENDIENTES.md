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

El modo operativo usa Node.js y SQLite local; no conecta Supabase ni otro servicio externo, y no activa hosting permanente o de pago. Las órdenes y gastos empiezan vacíos. La demo ficticia y la prueba limpia son compilaciones separadas que no leen ni escriben la base operativa.
