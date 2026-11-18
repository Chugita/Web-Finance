# GAX Analytics — configuración, privacidad y consultas

## Costos y límites
- Cloudflare Web Analytics: gratuito para tráfico y Web Vitals. Su activación se hace desde el dashboard de Cloudflare, en **Web Analytics** para `gaxsuite.com` (preferir **automatic setup** si está disponible).
- Workers Analytics Engine en Workers Free: 100.000 puntos escritos/día y 10.000 consultas/día incluidos, conforme a la documentación vigente el 18 de noviembre de 2026. Cloudflare puede cambiar precios. No activar Workers Paid ni funciones adicionales.
- Workers Free: 100.000 solicitudes/día, compartidas con otros Workers de la cuenta. El endpoint envía **como máximo un evento por categoría y carga de página** para mantener bajo el volumen.

## Qué se mide
| Evento | Significado | Etiqueta |
| --- | --- | --- |
| diagnostic_started | El usuario selecciona una respuesta por primera vez | vacío |
| question_completed | Avanza una pregunta | 1, 2, 3 o 4 |
| diagnostic_completed | Termina las cuatro preguntas | vacío |
| capacity_used | Interactúa con ingresos/gastos | vacío |
| time_used | Modifica plazo o aporte de comparador | vacío |
| goals_used | Selecciona o edita un objetivo | vacío |
| meeting_opened | Abre solicitud de conversación | nav / floating / closing / method / other |
| form_started | Empieza a completar el formulario | vacío |
| form_sent | Resend aceptó el correo al asesor (registrado en el Worker) | vacío |

**Estos datos son recuentos de interacciones, no visitantes únicos.** Para visitantes y vistas usar Cloudflare Web Analytics. Los eventos se deduplican dentro de cada carga de página; una recarga puede producir nuevos eventos.

## Privacidad
El endpoint acepta solo nombres y etiquetas de un listado cerrado. No recolecta respuestas del diagnóstico, ingresos, importes, nombres, emails, teléfonos, IDs de visitante, cookies ni direcciones IP en Analytics Engine. La IP se usa temporalmente únicamente para rate limiting del endpoint, sin almacenarse en el dataset. Los eventos frontend solo se registran en `gaxsuite.com` y `www.gaxsuite.com`, nunca en las vistas previas.

## Instalación segura / no hacer merge sin pruebas
1. Rama `gax-analytics-conversion-20261118`, parte de `main` y agrega `wrangler.jsonc` con Worker, Assets, rate limit y binding `GAX_EVENTS`.
2. Verificar **Preview Build** en Cloudflare y las rutas estáticas y `/api/gax-event`. La ruta GET debe devolver HTTP 405. Desde Preview no se generan eventos automáticamente para evitar falsear las estadísticas.
3. Mantener los secretos de Resend exclusivamente en Cloudflare. Si el Worker Preview se usa para correo, configurarlos separadamente en ese entorno.
4. **No cambiar producción hasta validar:** assets, simuladores, ambos idiomas, formulario de contacto, binding de Analytics Engine y rate limit.
5. Al publicar, revisar que el comando de producción utilice `npx wrangler deploy --config wrangler.jsonc`, y que exista el binding.
6. Activar Cloudflare Web Analytics desde el dashboard. No insertar otro beacon si automatic setup ya lo proporciona.

## Consultas SQL (Cloudflare Analytics Engine)
Dataset: `gax_site_events`. Se consulta con un token **Account Analytics Read**, guardado solo del lado del servidor, nunca en el navegador ni en GitHub.

Conteos de los últimos 30 días:

```sql
SELECT blob1 AS evento, blob2 AS detalle,
       SUM(_sample_interval) AS total
FROM gax_site_events
WHERE timestamp >= NOW() - INTERVAL '30' DAY
GROUP BY evento, detalle
ORDER BY total DESC
LIMIT 100
```

Tendencia diaria:

```sql
SELECT toDate(timestamp) AS dia, blob1 AS evento,
       SUM(_sample_interval) AS total
FROM gax_site_events
WHERE timestamp >= NOW() - INTERVAL '30' DAY
GROUP BY dia, evento
ORDER BY dia DESC, evento
LIMIT 1000
```

## Interpretación
- Visitas, visitantes únicos aproximados y origen: **Web Analytics**.
- Respuestas y simuladores: **Workers Analytics Engine**.
- Tasa de conversión orientativa: `form_sent / visitantes`, contrastando que ambas cifras cubran exactamente el mismo período. No es un embudo de usuarios únicos.
- Evitar medir `form_sent` desde el navegador: el Worker lo registra únicamente tras una respuesta exitosa de Resend.

## Próximas mejoras posibles
Un dashboard privado (solo para el responsable) exige controlar el acceso y ejecutar SQL del lado del servidor; **no exponer el token de Analytics en JavaScript frontend**. La primera versión puede consultarse con Cloudflare Analytics + SQL API, sin desarrollar infraestructura adicional.
