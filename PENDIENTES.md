# Pendientes antes del uso con datos reales

## 1. Probar los flujos operativos

- Validar en celular y computadora la recepción, borradores, inspección, fotos, cambios de estado, PDF, aprobación interna, gastos, filtros y exportación CSV.
- Añadir pruebas automatizadas y corregir los errores que aparezcan; el proyecto aún no tiene una suite completa de pruebas.
- Confirmar que exista un solo encargado inicial, que las demás cuentas correspondan únicamente a técnicos autorizados y que cada persona use su propia contraseña.

## 2. Respaldar y recuperar SQLite

- La base y las fotografías compartidas viven en `data/` en la computadora del taller. No hay respaldo automático ni sincronización fuera de esa computadora.
- Probar el respaldo completo de `data/` con el servidor detenido, y ensayar la recuperación antes de usar estos datos como único expediente.
- Definir quién puede acceder físicamente a la computadora, a la carpeta `data/` y a los medios de respaldo.

## 3. Reforzar el acceso de red para producción

- El servidor se ejecuta en la red local, pero HTTP no cifra la información que viaja entre la computadora del servidor y los dispositivos. Mantenerlo solo en una red privada y confiable; no abrir ni reenviar el puerto 3000 a Internet.
- Si se requiere usarlo en una red no confiable, configurar HTTPS local y validar certificados en los dispositivos antes de transmitir datos reales.
- Revisar reglas de firewall, actualizaciones del sistema y la política de conservación de datos personales del taller.

## 4. Acordar el alcance operativo pendiente

- La aprobación del cliente sigue siendo un registro interno; la app no envía WhatsApp/correo ni obtiene una firma electrónica. Definir canal, proveedor, consentimiento, requisitos legales y cualquier costo antes de integrar comunicaciones.
- La aplicación no se configura para iniciar automáticamente ni para alojarse permanentemente. Si más adelante se requiere arranque automático, definir primero responsable, mantenimiento, respaldo y controles de acceso del equipo.
- Los $43,395 MXN, cinco semanas, 240 horas y nombres que se muestran en Reportes son supuestos del plan del prototipo; confirmar o retirar si ya no son pertinentes.

## Límites deliberados de esta versión

El modo operativo usa Node.js y SQLite local; no conecta Supabase ni otro servicio externo, y no activa hosting permanente o de pago. Las órdenes y gastos empiezan vacíos. La demo ficticia y la prueba limpia son compilaciones separadas que no leen ni escriben la base operativa.
