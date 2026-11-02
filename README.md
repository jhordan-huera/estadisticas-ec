# Estadísticas EC

Generador automático de **imágenes y textos para redes sociales** sobre toda la Serie A de Ecuador: cartelera, resultados, resumen de cada fecha, tabla de posiciones, goleadores, estadísticas por equipo y previas con duelo directo. Calcula sus propias estadísticas acumuladas a partir de los datos de cada partido.

> **Aviso legal.** Estadísticas EC es un proyecto independiente, **no afiliado a la LigaPro ni a ningún club**. No usa sus nombres comerciales ni sus logos como marca propia. Identifica a los equipos con su nombre, una abreviatura, un color y, si está activado, su escudo. Cada imagen y cada texto llevan el aviso *"No afiliados a la LigaPro ni a los clubes"* (configurable en `marca.pie`). Los datos provienen de fuentes públicas de terceros (ESPN y TheSportsDB) y pueden contener errores u omisiones.

---

## Qué genera

| Pieza | Cuándo se publica | Contenido |
|---|---|---|
| Cartelera | Hasta 72 h antes del primer partido de la fecha | Partidos agrupados por día, hora de Ecuador y estadio |
| Resultado | Al terminar cada partido | Marcador, goleadores con minuto, expulsiones, puesto de cada equipo |
| Resumen de la fecha | Al completarse la fecha | Todos los resultados, mayor goleada, partido con más goles, totales |
| Tabla de posiciones | Solo si cambió, cuando ya no quedan partidos del día | Tablas de grupo o general, últimos 5, movimiento de puestos |
| Goleadores (top 10) | Tras cada fecha, solo si cambió | Acumulado gol a gol; los goles sin autor se informan aparte |
| Radiografía de equipo | Tras cada fecha, del equipo con la racha más notable | Últimos 5, goles a favor y en contra, local/visita, vallas invictas |
| Previa (carrusel de 2–3 imágenes) | 24 h antes de cada partido | 1) La previa: puesto, balance, últimos 5, racha y rendimiento local/visita · 2) Cara a cara en números: comparativa de la temporada y goleador de cada equipo · 3) Duelos del año con goleadores (si ya se enfrentaron) |

Cada pieza se genera en **1080×1350** (vertical, la que se publica) y **1080×1080** (cuadrada). La previa se publica como **carrusel**: Instagram la cuenta como una sola publicación, así que no consume el límite diario por triplicado. Los textos se redactan con **plantillas propias y reglas por situación** (goleada, remontada, empate sin goles, líder nuevo, rachas…), con variantes elegidas de forma determinista. **No se usa inteligencia artificial.**

## Requisitos

- **Node.js 26** o superior: ejecuta TypeScript directamente y trae SQLite integrado (`node:sqlite`).
- npm.
- Para publicar en Instagram: una cuenta profesional y una app de Meta (ver más abajo).

## Instalación

```bash
npm ci                    # instala dependencias
npm run sincronizar       # descarga la temporada y crea la base de datos (data/marcador.sqlite)
npm run cli -- muestras   # genera las 7 piezas con datos reales en out/muestras/
```

## Comandos

Todos se ejecutan con `npm run cli -- <comando>` (o `node src/cli/main.ts <comando>`).

| Comando | Qué hace |
|---|---|
| `migrar` | Aplica las migraciones pendientes de la base de datos |
| `sincronizar [--competicion serie-a]` | Descarga y guarda los datos (todas las competiciones por defecto) |
| `estado` | Resumen de lo guardado por competición y fase |
| `fecha --numero 5 [--fase 2]` | Partidos de una fecha |
| `incidencias [--nivel warning] [--detalle]` | Anomalías de datos registradas |
| `tabla [--general]` | Tabla de posiciones vigente |
| `goleadores [--top 10]` | Tabla de goleadores |
| `equipo --equipo LDU` | Perfil del equipo |
| `duelo --local LDU --visita IDV` | Historial de la temporada entre dos equipos |
| `resumen [--fase 2 --numero 5]` | Resumen de una fecha (por defecto, la última completa) |
| `verificar` | Contrasta nuestra tabla con la que publica ESPN |
| `muestras [--formato vertical\|cuadrado] [--logos]` | Genera las 7 piezas con datos reales (con `--logos`, en `out/muestras-con-logos/`) |
| `sitio [--salida out/sitio]` | Genera el panel web estático |
| `planificar` | Decide qué publicar y lo encola (sin duplicados) |
| `generar` | Dibuja imagen y texto de lo pendiente |
| `publicar` | Publica lo generado (en **simulación** salvo `DRY_RUN=false`) |
| `ciclo` | `sincronizar` + `planificar` + `generar` + `publicar` |
| `cola [--todas]` | Estado de la cola de publicaciones |
| `diagnostico` | Revisa las credenciales de Instagram (no publica nada) |
| `limpiar [--dias 30]` | Borra imágenes antiguas |

Los comandos del planificador aceptan `--ahora 2026-11-08T23:00:00Z` para simular la hora.

Calidad del código:

```bash
npm run typecheck   # verificación de tipos
npm test            # pruebas (motor de estadísticas, planificador, cola, textos, proveedores, publicador)
```

## Configuración

### Archivos (versionados, sin secretos)

- **`config/marcador.config.json`**:
  - marca, temporada y zona horaria;
  - competiciones y proveedores;
  - reglas de la tabla: puntos, **puntos acumulados o reiniciados en la fase final** y orden de desempate;
  - hashtags;
  - límites de publicación: **límite diario**, formato, anticipación de cartelera y previas, tipos de pieza por competición, `desde` (fecha de arranque: nada sobre partidos anteriores se publica; útil el primer día para no publicar resultados viejos) y `anchoInstagram` (ancho del JPEG publicado; 1440 px por defecto, el máximo que guarda Instagram, para que se vea nítido al acercar);
  - perfiles de red: intervalo entre peticiones, reintentos y caché.
- **`config/equipos.json`**:
  - nombre, nombre corto, abreviatura, **color** y color de texto de cada equipo (se usan cuando no hay logos);
  - alias para enlazar el mismo club entre proveedores;
  - hashtag propio opcional.

### Variables de entorno

| Variable | Por defecto | Uso |
|---|---|---|
| `DRY_RUN` | `true` | Simulación: guarda lo que se publicaría en `out/dry-run/`. Solo `false` publica de verdad |
| `IG_USER_ID` | — | ID de la cuenta profesional de Instagram (**secreto**) |
| `IG_ACCESS_TOKEN` | — | Token de acceso (**secreto**; nunca se imprime ni se guarda) |
| `IMAGE_BASE_URL` | — | Base pública de las imágenes, p. ej. `https://raw.githubusercontent.com/<usuario>/<repo>/estado` |
| `MARCADOR_DB` | `data/marcador.sqlite` | Base de datos |
| `MARCADOR_MEDIA` | `out/posts` | Carpeta de imágenes generadas |
| `MARCADOR_STATE_DIR` | `.` | Raíz del estado; las URL públicas se calculan relativas a ella |
| `MARCADOR_CACHE_DB` | `data/cache-http.sqlite` | Caché HTTP (efímera) |
| `TSDB_API_KEY` | `123` | Clave de TheSportsDB (la gratuita es pública) |
| `MARCADOR_USAR_LOGOS` | — | `true` o `false`: sobrescribe `usarLogos` sin tocar la configuración |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` o `error` |

Hay un ejemplo en [`.env.example`](.env.example).

## Arquitectura

```
src/
  core/        configuración, registro de eventos (oculta secretos), zona horaria, cliente HTTP
               (límite de tasa, caché con vencimiento, reintentos con espera exponencial)
  providers/   interfaz DataProvider + ESPN (liga) + TheSportsDB (copas, módulo aparte)
  db/          conexión SQLite, migraciones numeradas, repositorios
  sync/        ingesta en una transacción, comprobaciones de integridad, inferencia de jornadas
  stats/       motor de estadísticas puro: tabla, goleadores, rachas, perfiles, duelos, fechas
  content/     modelos de vista compartidos por imágenes y textos
  design/      sistema de diseño: paleta, tipografía, rejilla, componentes
  render/      plantillas y conversión SVG → PNG/JPEG (satori + resvg)
  copy/        redactor: banco de frases, reglas por situación, variantes deterministas, hashtags
  scheduler/   planificador por eventos y cola persistente con prioridades y límite diario
  publish/     interfaz Publisher: simulación (por defecto) e Instagram Graph API
  site/        panel web estático de solo lectura
  cli/         comandos
```

**Cambiar de fuente de datos.** Se implementa la interfaz `DataProvider` (`src/providers/types.ts`), que devuelve una foto de temporada con equipos, fases, grupos, partidos y eventos, y se registra en `src/providers/registry.ts`. Sirve, por ejemplo, para datos entregados por un club o una licencia oficial. El resto del sistema no cambia.

**Modelo de datos (SQLite):**
- competiciones, temporadas, fases, grupos;
- equipos y jugadores, con identificadores por proveedor;
- partidos y eventos (goles, autogoles, penales, tarjetas);
- correcciones manuales: `round_overrides` (jornadas) y `point_adjustments` (sanciones);
- la tabla publicada por el proveedor, para contrastar la nuestra;
- `data_issues` (incidencias), `posts` (cola de publicaciones), `content_snapshots` (huellas) y `sync_runs`.

## Fuentes de datos (verificadas)

- **ESPN, liga `ecu.1`.** Una sincronización completa son 5 peticiones: fases, tabla y el scoreboard anual. Defectos reales detectados y corregidos automáticamente:
  - **No entrega número de fecha.** Se infiere asignando cada partido a la primera jornada libre de ambos equipos. Con la temporada 2026 da 30 fechas exactas de 8 partidos, con los aplazados en su fecha original. Una fecha mal inferida se corrige insertando una fila en `round_overrides`.
  - Etiqueta mal la fase de algunos partidos: la fase se decide por la fecha del partido.
  - El grupo que indica en el scoreboard no es fiable: se toma de la tabla.
  - Algún partido trae menos goles con detalle que su marcador: queda registrado como incidencia y como "gol sin autor".
- **TheSportsDB (Copa Ecuador y Supercopa).** Plan gratuito:
  - máximo 15 partidos por consulta (se avisa cuando una ronda llega truncada);
  - sin goleadores ni marcador de penales (el ganador se deduce de la ronda siguiente);
  - límite de tasa estricto: el sistema espacia las peticiones unos 3,5 s.

Ninguna anomalía se descarta en silencio: todas quedan en `data_issues` (`npm run cli -- incidencias --detalle`). Las que dejan de repetirse se marcan como resueltas solas.

## Publicación en Instagram

La publicación usa la **API oficial de Instagram** y funciona así:

1. La imagen JPEG se sube al repositorio, en la rama `estado`.
2. Instagram la descarga desde su URL pública de `raw.githubusercontent.com`. Por eso el **repositorio debe ser público** (o `IMAGE_BASE_URL` debe apuntar a otro alojamiento público).
3. El sistema crea un contenedor con la imagen y el texto, espera a que esté listo y lo publica. En un carrusel, crea un contenedor por imagen y uno padre con el texto.

Se admiten los dos accesos oficiales de Meta. El host se detecta por el tipo de token:
- **Inicio de sesión con Instagram** (token `IGAA…`) → `graph.instagram.com`. No necesita página de Facebook.
- **Inicio de sesión con Facebook** (token `EAA…`) → `graph.facebook.com`.

Pasos:

1. Convierte la cuenta de Instagram en **profesional** (Creador o Empresa).
2. En [developers.facebook.com](https://developers.facebook.com) crea una app y añade el producto **Instagram**. Autoriza tu cuenta con los permisos de publicación de contenido y genera un token.
3. En GitHub, ve a *Settings → Secrets and variables → Actions* y crea los secretos `IG_USER_ID` e `IG_ACCESS_TOKEN`.
4. Ejecuta el workflow **"Diagnóstico de Instagram"**. Muestra el tipo de token, la cuenta y el cupo, sin imprimir el token.
5. Para publicar de verdad, crea la variable de repositorio `DRY_RUN` con el valor `false`, o lanza **"Publicar"** a mano con el modo `real`.

Sin credenciales, el sistema sigue generando contenido y lo deja en cola. Si se corta la conexión justo al publicar, la publicación queda como fallida con "estado incierto" y **no se reintenta sola**, para evitar duplicados: revisa la cuenta antes de reintentarla.

**Token.** Los tokens `IGAA…` duran 60 días y se renuevan con la API de Meta (`refresh_access_token`) antes de vencer. Si actualizas el secreto a mano, el diagnóstico te muestra si el token funciona. Este proyecto **no guarda tokens en el repositorio**, ni siquiera cifrados.

## Automatización (GitHub Actions)

| Workflow | Disparo | Qué hace |
|---|---|---|
| **CI** | push y pull request | Verificación de tipos y pruebas |
| **Publicar** | cada hora (minuto 17) y manual | Ver el detalle debajo de la tabla |
| **Sitio** | cada 30 minutos y manual | Genera el panel y lo despliega en GitHub Pages |
| **Diagnóstico de Instagram** | manual | Revisa credenciales |

El workflow **Publicar** sigue estos pasos:
1. Sincroniza, planifica y genera.
2. Sube el estado: la base de datos y las imágenes van a la rama `estado`.
3. Publica.
4. Vuelve a guardar el estado, **aunque la publicación haya fallado**, para que la cola recuerde qué salió.

Además:
- Se ejecuta **una sola vez a la vez** (control de concurrencia).
- Usa caché de dependencias de npm.
- Los secretos llegan solo como variables de entorno.

**Ejecutar cada 10 minutos (cron-job.org).** Las ejecuciones programadas de GitHub son, como mucho, horarias y pueden retrasarse. Para publicar los resultados a los pocos minutos, un servicio externo puede lanzar el workflow con la API de GitHub:

1. En GitHub crea un token *fine-grained* (*Settings → Developer settings → Personal access tokens → Fine-grained tokens*). Limítalo solo a este repositorio y dale el permiso **Actions: Read and write** y nada más.
2. En [cron-job.org](https://console.cron-job.org) crea un trabajo cada 5 o 10 minutos con estos datos:
   - **URL:** `https://api.github.com/repos/<usuario>/<repo>/actions/workflows/publicar.yml/dispatches`
   - **Método:** `POST`
   - **Cabeceras:** `Accept: application/vnd.github+json`, `Authorization: Bearer <token>`, `X-GitHub-Api-Version: 2022-11-28` y `Content-Type: application/json`
   - **Cuerpo:** `{"ref":"main","inputs":{"modo":"automatico"}}`
3. La prueba debe responder **HTTP 204**.

Con el modo `automatico` manda la variable `DRY_RUN`: para pasar a simulación no hace falta tocar cron-job.org. Las copas (TheSportsDB) se sincronizan como mucho una vez por hora (`sincronizar --cada 60`), para respetar su límite de peticiones. La rama `estado` solo se sube cuando cambia algo relevante (comando `huella`), así una ejecución sin novedades no genera un commit.

**La rama `estado`** contiene la base de datos SQLite y las imágenes de los últimos 30 días. Se reescribe en cada ejecución como un único commit, para que el repositorio no crezca con el historial de imágenes. No la edites a mano.

Para activar el panel web: *Settings → Pages → Source: GitHub Actions*.

## Panel web

`npm run cli -- sitio` genera `out/sitio/index.html` (HTML estático sin JavaScript, adaptado a móvil) y `out/sitio/datos.json` con la tabla, los goleadores, los resultados recientes y los próximos partidos.

## Límites conocidos

- Los endpoints de ESPN son públicos pero **no oficiales**: pueden cambiar sin aviso. El proveedor valida lo que recibe y registra cualquier forma inesperada.
- Las **jornadas se infieren**. Un calendario muy irregular, con varios aplazados de la misma fecha, puede requerir una corrección manual en `round_overrides`.
- Las **reglas de la tabla** (puntos acumulados en la fase final y desempates) son configurables. Conviene contrastarlas con el reglamento oficial vigente. Las sanciones de puntos se cargan a mano en `point_adjustments`; el comando `verificar` avisa si la tabla no coincide con la de ESPN.
- Las copas (TheSportsDB gratuito) no traen goleadores, y sus rondas pueden llegar incompletas.
- Los resultados se publican **hasta ~1 hora** después del partido (frecuencia del workflow). GitHub puede retrasar los workflows programados. No hay publicaciones en vivo.
- Instagram impone su propio cupo de publicaciones en 24 h; el sistema lo consulta antes de publicar.
- Las piezas usan los **escudos de los clubes** (`assets/logos/`, `"usarLogos": true`). Son marcas de sus titulares: publicarlas es decisión y responsabilidad del operador de la cuenta. Con `"usarLogos": false` se vuelve a las marcas de color propias.

## Licencia

Código bajo la [Licencia Estadísticas EC 1.0](LICENSE). Tipografías Barlow y Barlow Condensed bajo SIL Open Font License 1.1 (ver `assets/fonts/`). Los nombres de equipos y competiciones pertenecen a sus titulares y se usan solo con fines informativos.
