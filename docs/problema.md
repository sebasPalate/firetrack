# Firetrack — Armonización de hotspots MODIS y VIIRS

**Evento:** NASA Space Apps Challenge 2026
**Equipo:** 3 personas — ingeniería de software (dev), ingeniería mecánica, ingeniería industrial
**Ventana real:** sábado 11:00 → domingo 17:00 (30 h de reloj, ~21 h de trabajo efectivo)
**Estado:** definición del problema. No hay código escrito.
**Idioma:** documento de trabajo del equipo. La entrega, la presentación y el README final van en inglés.

> Documento canónico: este archivo es el que el equipo edita durante el hackathon.
> `docs/problem.md` es la versión en inglés para el jurado y se regenera desde acá antes del cierre.
> Si hay divergencia, manda este.

---

## 1. El problema en un párrafo

Los satélites detectan hotspots de fuego activo desde hace más de 25 años, pero el registro está partido
entre sensores (MODIS: 2000→, VIIRS: 2012→) con distinta resolución espacial, sensibilidad y horario de
pasada. Sus conteos crudos **no son comparables**, así que hoy nadie puede responder con honestidad
"¿este mes fue inusualmente activo?" usando la serie combinada. Tenemos que (a) producir una única serie
temporal armonizada de hotspots MODIS + VIIRS, y (b) entregar una aplicación web que la convierta en un
calendario de actividad de quema para un área de interés elegida por el usuario, de modo que un
responsable de emergencias vea patrones estacionales, compare el mes actual contra la mediana histórica y
descargue las detecciones.

## 2. Qué pide literalmente el desafío

Dos fases, ambas obligatorias:

1. **Armonización** — "el sensor de origen deja de importar; el foco pasa a ser patrones, tendencias y anomalías".
2. **Aplicación web** — elegir región + rango de fechas, visualizar la actividad, descargar analítica.

Salidas explícitas pedidas:

| # | Salida | Dónde lo pide |
|---|---|---|
| O1 | Calendario de actividad de quema, inicios de 2000 → presente, armonizado | "A calendar of burning activity ... a view of the fire history" |
| O2 | "Qué épocas del año tienen más fuego / qué años tuvieron más actividad" | mismo párrafo |
| O3 | Mes actual vs mediana histórica | "compare the burning activity of the current month against the historical median" |
| O4 | Selección de región (dibujar AOI, o lat/lon) | "Potential Considerations" |
| O5 | Rampas de color accesibles | "Consider using accessible color ramps" |
| O6 | Descarga CSV de los hotspots de la búsqueda | "A downloadable CSV File of hot spots detected during a search" |
| O7 | Anomalías contra promedios multianuales | "Historical comparisons, including anomalies against multi-year averages" |

Opcional pero de alto valor: FRP/intensidad, mostrar procedencia del sensor, regiones predefinidas, cola
casi-real-time.

## 3. El núcleo técnico (acá está todo el desafío)

Los conteos crudos de hotspots son un artefacto del instrumento, no del fuego:

| Propiedad | MODIS (Terra, Aqua) | VIIRS (S-NPP, NOAA-20, NOAA-21) |
|---|---|---|
| Píxel nominal | 1 km | 375 m (banda I), agregado a ~750 m |
| Satélites en el registro | 2 (ambos al final de su vida útil) | 3 (S-NPP 2012→, NOAA-20 2018→, NOAA-21 2022→) `[VERIFICAR]` |
| Pasadas por día | 2 por satélite (~10:30/22:30, ~13:30/01:30 local) | 2 por satélite, ~13:30/01:30 local |
| Inicio del registro | nov 2000 | ene 2012 |
| Campo de confianza | `confidence` 0–100 (numérico) | `confidence` l / n / h (categórico) |
| Detecciones efectivas | menos, píxeles más gruesos | del orden de 3–10× más detecciones por el mismo complejo de fuego `[MEDIR en la auditoría]` |

**Consecuencia:** un calendario que pone enero 2005 al lado de enero 2024 muestra un salto que en su
mayoría es "agregamos tres satélites VIIRS". Ese es exactamente el modo de falla que el desafío está
diseñado para castigar. Acá la armonización no es preprocesamiento: es el entregable.

### Estrategias de armonización candidatas

| ID | Estrategia | A favor | En contra |
|---|---|---|---|
| H1 | Agregar a grilla gruesa y normalizar por oportunidad de observación | principalista, barato | requiere contar pasadas/vobservaciones válidas, que FIRMS no entrega limpio |
| H2 | **Calibración por ventana de solapamiento**: usar 2012→presente, donde ambos sensores operan, derivar un factor de escala mensual por celda y aplicarlo a la era VIIRS | responde directo a "hacelos comparables", demostrable con un gráfico de validación | necesita suficientes muestras por celda; celdas dispersas requieren fallback regional/global |
| H3 | **Presencia binaria** por celda-mes (hubo / no hubo fuego) | casi independiente del sensor, muy barato | pierde información de intensidad |
| H4 | Conteos ponderados por FRP o filtrados por umbral de confianza | físicamente significativo | sigue sesgado por resolución, requiere supuestos |

**Elección propuesta:** H2 como serie primaria, H3 como control de sanidad independiente, ambas a
**grilla de 0.25° y 1°, resolución mensual**, al menos modo sobre el registro completo. Se entrega
explícitamente como *índice de actividad armonizado*, no como "cantidad de incendios": ese encuadre es
honesto y defendible ante el jurado. Los conteos nativos quedan disponibles en el CSV con columna
`sensor`, así la procedencia nunca se pierde.

Control de la ventana de solapamiento: si el índice calibrado no reproduce la tendencia MODIS-only durante
2012–2015 (donde ambos existen), el método está mal y lo decimos.

## 4. Datos — plan corregido (verificado 2026-11-14)

### 4.0 Qué es cada recurso

| Recurso | Qué es realmente | ¿Se consume? |
|---|---|---|
| `earthdata.nasa.gov/data/tools/firms` | Ficha de catálogo que describe la herramienta FIRMS | **No.** Es documentación, no una API |
| `firms.modaps.eosdis.nasa.gov/api/area/` | **API de área**: hotspots por bbox + rango de días, en CSV | Sí, requiere `MAP_KEY` |
| `firms.modaps.eosdis.nasa.gov/download/` | Archivo histórico (shp/csv/json) | Sí, con Earthdata Login o código por email, y es **asíncrona** |

### 4.1 `MAP_KEY`

Es una clave gratuita asociada a un email. Se pide en `/api/map_key/`, llega por correo y sirve para
autenticar tanto la API de área como los map services de FIRMS. No es un usuario ni una suscripción.

- Límite: **5000 transacciones / 10 min**.
- Un pedido de N días cuenta aproximadamente como N transacciones `[VERIFICAR]`.
- La misma clave se puede pedir de nuevo / modificar desde el portal de descarga.

**Consecuencia de diseño:** el backend **no** consume FIRMS en runtime para el histórico. Consume nuestros
propios artefactos precomputados. FIRMS se toca solo en el pipeline, una vez, y en la cola de días recientes.

### 4.2 Cobertura real por producto (de la página de descarga de FIRMS)

| Producto | Cobertura |
|---|---|
| MODIS C6.1 (SP) | 2000-11-01 → presente (con ~5 meses de rezago) |
| VIIRS S-NPP 375 m (SP) | 2012-01-20 → **2026-11-02 (terminado)** |
| VIIRS NOAA-20 375 m (SP) | 2018-04-01 → presente |
| VIIRS NOAA-21 375 m (SP) | 2023-03-01 → presente |
| LANDSAT 30 m | 2022-06-20 → presente (no aplica al calendario) |

**Hallazgo crítico:** S-NPP ya no entrega datos, así que por sí solo no cubre "hoy". La cola reciente
necesita NOAA-20 (y opcionalmente NOAA-21).

### 4.3 Estrategia de ingesta elegida (sin cuenta Earthdata)

Ingesta por **API de área**, por bloques de 5 días, sobre AOIs acotadas:

- ~1826 pedidos por sensor por AOI para 25 años (9130 días / 5). Con 3 sensores ≈ 5.5k pedidos por AOI.
- Con 8–16 workers en paralelo y ventanas de 5 días, se estima **15–40 min por AOI** `[MEDIR con un test cronometrado de 1 año]`.
- El pipeline es **idempotente y reanudable** por `(aoi, sensor, ventana)`: guarda el CSV crudo y no repite pedidos.
- Cola reciente: productos `_NRT` para los últimos ~5 meses (los `_SP` tienen rezago). Deduplicar prefiriendo `_SP` cuando exista.

Ventaja: no depende de emails ni de una cuenta, corre hoy, y es reproducible desde scripts.

### 4.4 Estrategia de archivo histórico (rechazada para hoy, plan B)

Requiere Earthdata Login o código por email, permite **un año global por pedido** y la entrega es
**asíncrona por email** (reportado por participantes en la discusión #1786 de `nasa/spaceapps`; el
volumen global en CSV se estima en ~45 GB, no verificado por nosotros).

Es la vía correcta para "todo el planeta", pero no es una vía viable en una ventana de 30 h. Se usa solo
si aparece tiempo muerto, y como fuente de un año de validación cruzada.

### 4.5 Consecuencia de alcance

Con ingesta por API, cubrir **todo el planeta** no es viable. Se invierte la decisión anterior:

- **Primario:** 6–9 regiones predefinidas con calendario completo 2000→presente.
- **Secundario:** AOI arbitraria en modo "cobertura limitada" (ventana corta, declarada en la UI).
- **Descartado:** grilla global 0.25° completa. Un grid mensual global son ~1,04 M celdas × 300 meses:
  es un backend, no un dataset que se pueda enviar al navegador.

### 4.6 Campos a armonizar

Comunes: `latitude`, `longitude`, `acq_date`, `acq_time`, `satellite`, `instrument`, `frp`, `daynight`, `type`.
Divergentes: `brightness`/`bright_ti4`, `bright_t31`/`bright_ti5`, `scan`, `track`, `confidence` (0–100 vs l/n/h), `version`.
Esquema armonizado: una sola tabla con `sensor`, `platform`, `pixel_km`, `confidence_score` (0–1 normalizado), `frp`, `datetime_utc`, `cell_id`.

## 5. Alcance

**Imprescindible (sin esto no hay demo)**
1. Dataset precomputado de grilla mensual armonizada, 2000→2026, MODIS + VIIRS.
2. App web con selección de AOI por bbox/lat-lon y rango de fechas.
3. Calendario de quema (mes × año) sobre valores armonizados, rampa accesible, leyenda, valores al pasar el mouse.
4. Vista de estacionalidad por mes y de totales por año.
5. Mes actual (o mes seleccionado) vs mediana histórica, con llamado claro de "anomalía".
6. Descarga CSV de las detecciones detrás de la vista actual.
7. Procedencia visible: sensores usados, método de armonización, advertencia de que los valores son un índice.

**Deseable**
8. Capa de mapa con los hotspots del AOI/rango.
9. Regiones predefinidas sensibles (Amazonía, Cerrado, California, Mediterráneo, Australia, Chaco).
10. URL compartible que codifique AOI + rango.
11. Alternar FRP/intensidad.

**Fuera de alcance (v1)**
- Dibujo libre de polígonos (solo bbox; el texto del desafío acepta latitud/longitud).
- Cuentas de usuario, historial en base, streaming más allá de la cola reciente.
- Armonización píxel a píxel o modelado de transferencia radiativa.

## 6. Requisitos (verificables)

- **S1** El usuario define un AOI por bbox (dibujando en el mapa o tipeando oeste/sur/este/norte). Entrada inválida muestra un mensaje específico y no consulta.
- **S2** El usuario elige un rango de fechas acotado a 2000-11-01 → presente; por defecto, el registro completo.
- **S3** El calendario renderiza meses (filas) × años (columnas) desde la serie armonizada del AOI, con rampa secuencial segura para daltonismo y leyenda que declare la unidad ("índice de actividad armonizado").
- **S4** Para cualquier mes+año seleccionado, la app muestra el valor, la mediana multianual de ese mes calendario y la anomalía en delta absoluto y en porcentaje.
- **S5** La app renderiza la serie mensual sobre el rango elegido.
- **S6** La app renderiza la estacionalidad (media o mediana por mes calendario a través de los años) del AOI.
- **S7** La descarga CSV contiene los campos armonizados más los campos nativos y `sensor`, exactamente para el AOI + rango actual.
- **S8** Un panel de procedencia visible declara fuentes, método de armonización, ventana de calibración y limitaciones conocidas.
- **S9** Una consulta típica de AOI responde desde el almacén precomputado en menos de 2 s.
- **S10** Puerta de calidad de la armonización: durante la ventana de solapamiento, el índice calibrado reproduce la serie nativa MODIS dentro de una tolerancia declarada; existe el gráfico que lo prueba en el repo y está enlazado desde la app.

## 7. Guion del demo (lo que ve el jurado, 5 minutos)

1. Elegir una región castigada por el fuego (Amazonía brasileña, o el Chaco por el crédito de CONAE) con el registro completo.
2. El calendario se llena: banda de estación seca visible, 2024 vs 2005 **sin** el salto artificial de sensor — ese es el "wow".
3. Pasar el mouse por un mes: valor, mediana, anomalía.
4. Cambiar a estacionalidad y totales anuales.
5. Descargar el CSV en vivo.
6. Mostrar el gráfico de calibración y declarar la limitación en voz alta. El jurado premia honestidad sobre método más que un gráfico lindo y falso.

## 8. Riesgos

| ID | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| R1 | Acceso al archivo histórico bloqueado o muy lento (cuenta, tamaño) | mata la armonización | resolver en las primeras 4 h; plan B = muestra de 10 años pre-extraída commiteada + limitación declarada |
| R2 | La armonización no resulta creíble | entrega débil | presentar un índice, publicar el gráfico de validación de solapamiento, declarar límites (S8, S10) |
| R3 | Scope creep hacia dibujo de polígonos / auth / datos en vivo | no hay demo terminada | solo bbox, presets estáticos, datos precomputados |
| R4 | Un solo desarrollador para datos + web | cuello de botella | el dev hace pipeline primero y esqueleto de UI después; los no-devs se hacen cargo de validación, requisitos, QA y entrega |
| R5 | La confianza de VIIRS es categórica y la de MODIS numérica | bug de filtrado silencioso | normalizar a un único `confidence_score` en el pipeline, con test unitario del mapeo |
| R6 | Corrimiento de fecha por `acq_date` + `acq_time` | meses corridos en el calendario | guardar datetime UTC, documentar la convención, testear con un evento conocido |

## 9. Reparto de trabajo

Tres pistas. Cada pista tiene entregables por bloque y definición de terminado — nadie espera a nadie.

| Pista | Dueño | Es dueño de | Terminado cuando |
|---|---|---|---|
| **A. Datos y software** | Ing. de software | Pipeline (ingesta → normalización → grilla → armonización → almacén), backend/API, frontend del calendario y gráficos, exportación CSV | S1–S9 pasan sobre el AOI del demo; el repo reproduce el dataset desde scripts |
| **B. Validación física y caracterización de sensores** | Ing. mecánico | Comparación de sensores: geometría de pasada, footprint del píxel según ángulo de escaneo, umbrales de detección, significado del FRP; la metodología de calibración; validación contra eventos de fuego conocidos (Amazonía 2019, Australia 2019–20, Canadá 2023); escribe la sección de método | Un método calibrado con gráfico de validación sobre eventos reales, más una declaración escrita de los supuestos físicos y sus modos de falla |
| **C. Producto, métricas y entrega** | Ing. industrial | Definición de usuario y recorrido para respondedores de emergencia, definición de métricas (qué significa "anomalía" operativamente, umbrales, elección de agregación), plan y checklist de QA, registro de riesgos, texto de la entrega, guion del demo, video, README para el jurado | Requisitos firmados, checklist de QA ejecutada antes de cada corrida de demo, materiales de entrega listos 90 min antes del cierre |

Por qué los no-devs tienen trabajo real: este desafío se gana o se pierde en **credibilidad del método y
comunicación**, no en CRUD. La pista B decide si los números significan algo; la pista C decide si alguien
les cree.

Transversal: sync de 15 min al inicio de cada bloque, un registro de decisiones, un repo, y una sola
persona commitea (el dev) salvo acuerdo explícito.

### Mapa de propiedad de artefactos

| Artefacto | Dueño |
|---|---|
| `data/` scripts del pipeline | A |
| `docs/method.md` — matemática de armonización + validación | B |
| `docs/qa-checklist.md`, `docs/risk-register.md` | C |
| Aplicación web | A |
| Guion del demo + video + formulario de entrega | C |
| AOIs predefinidas y su justificación | B + C |

## 10. Cronograma (30 h de reloj)

| Bloque | Horario | Objetivo | Dueño |
|---|---|---|---|
| **B0 Arranque** | Sáb 11:00–12:30 | D1–D5 decididas, stack fijado, repo y estructura listos | Todos |
| **B1 Auditoría de datos** | Sáb 12:30–15:00 | `MAP_KEY`, acceso a archivos históricos confirmado o plan B elegido, un AOI cargado con 3 sensores, esquema mapeado | A (B en paralelo: tabla de eventos de validación) |
| **B2 Pipeline v0** | Sáb 15:00–21:00 | dataset normalizado + grilla armonizada 0.25°, serie completa, gráfico de calibración S10 | A |
| **B2b Paralelo** | Sáb 15:00–21:00 | metodología escrita + eventos de validación / requisitos congelados + guion del demo | B / C |
| **Cena + sync (G1)** | Sáb 21:00–22:00 | revisión de la puerta G1 | Todos |
| **B3 Núcleo de la app** | Sáb 22:00–Dom 02:00 | AOI + rango → calendario + mediana funcionando con datos reales | A |
| **Descanso** | Dom 02:00–08:00 | dormir, obligatorio | Todos |
| **B4 Validación + QA** | Dom 08:00–12:00 | S10 validado en eventos reales, CSV, panel de procedencia, QA ejecutada | B/C + A |
| **B5 Pulido + deploy** | Dom 12:00–15:00 | estacionalidad, mapa, accesibilidad, URL pública estable | A |
| **B6 Entrega** | Dom 15:00–16:30 | video, README, formulario, ensayo | C |
| **Margen** | Dom 16:30–17:00 | buffer, nada nuevo | Todos |

### Puertas de decisión (si no se cumple, se recorta, no se estira)

- **G0 — Sáb 12:30.** Sin stack ni decisiones D1–D5, se cae al mínimo: pipeline en Python + app de una sola página, sin framework.
- **G1 — Sáb 21:00.** Sin grilla armonizada, se recorta a MODIS + VIIRS S-NPP con calibración global (no por celda) y se sigue. Sin datos históricos, se baja a una ventana de 3–5 años vía API con caché commiteada y se declara la limitación en el panel de procedencia.
- **G2 — Dom 02:00.** Si el calendario no se dibuja con datos reales, el domingo se invierte en eso y se eliminan mapa, estacionalidad y presets.
- **G3 — Dom 12:00.** Si faltan CSV o panel de procedencia, se prioriza el CSV: es requisito explícito del desafío.
- **G4 — Dom 15:00.** Congelamiento de código. Ninguna feature nueva después de esta hora.

## 11. Decisiones — cerradas

| ID | Decisión | Motivo |
|---|---|---|
| **D1** | **Monorepo** `apps/web` (Next.js + Tailwind) + `services/api` (FastAPI) + `pipeline/` (Python ETL) + `data/` | El pipeline no es el backend: mezclarlos infla la imagen y acopla el ETL a la API |
| **D2** | **6–9 regiones predefinidas** con registro completo; AOI arbitraria en modo "cobertura limitada" | La ingesta por API no permite cobertura global en 30 h |
| **D3** | **`MODIS_SP` + `VIIRS_SNPP_SP` + `VIIRS_NOAA20_SP`** (+ NRT para la cola reciente) | S-NPP termina el 2026-11-02; sin NOAA-20 la serie no llega a hoy |
| **D4** | Commitear **solo** agregados (Parquet/JSON pequeños), nunca detecciones crudas | Tamaño de repo vs reproducibilidad: los crudos se regeneran con scripts |
| **D5** | Next.js en Vercel; FastAPI en Railway/Render/Fly con los Parquet al lado | Dos despliegues simples y gratuitos |

## 12. Próximas acciones

1. Obtener el `MAP_KEY` (llega por email) y correr un **test cronometrado de 1 año** en un AOI chico para medir latencia real por pedido.
2. Medir volumen de filas por sensor-año en ese AOI y fijar el tamaño de la grilla con evidencia.
3. Generar el primer `calendar.json` real de un AOI (Chaco o Amazonía) y recién ahí empezar la UI.
4. Congelar S1–S10 como contrato de aceptación; todo lo nuevo va a "Deseable".

---

## 13. Arquitectura y stack

### 13.1 Estructura del monorepo

```
firetrack/
  apps/web/          Next.js (App Router) + TypeScript + Tailwind
  services/api/      FastAPI + DuckDB (lectura de Parquet)
  pipeline/          Python ETL: ingesta → normalización → grilla → armonización → artefactos
  data/              artefactos generados (crudos ignorados por git)
  docs/
```

### 13.2 Por qué FastAPI y no Django

El backend es un **servicio de lectura analítica**, no una aplicación con usuarios:

- Sin auth, sin admin, sin migraciones, sin ORM. Django aporta 80% que no se usa y cobra la configuración.
- `DuckDB` sobre Parquet es una consulta SQL directa: 10 líneas y ya hay endpoint.
- **OpenAPI automático** (`/docs`) = credibilidad gratis frente al jurado: la API se puede mostrar y probar.
- Django REST Framework obliga a serializers/viewsets para 5 endpoints: valor negativo en 30 h.

### 13.3 Por qué Next.js sí, con una condición

Next.js sirve como capa de presentación: componentes, Tailwind, MapLibre para el mapa, deploy en Vercel.
**Condición no negociable:** la lógica de datos NO vive en `app/api/*` ni en Server Components.

- DuckDB dentro de una función serverless es una trampa: binario nativo, cold start, límites de tamaño.
- Componentes de cliente (`"use client"`) + `fetch` a `NEXT_PUBLIC_API_URL`.
- CORS habilitado en FastAPI para el dominio de Vercel.

Si en algún momento se duda entre "meter la consulta en Next" y "exponer un endpoint en FastAPI": endpoint.

### 13.4 Contrato de la API (5 endpoints)

| Endpoint | Devuelve |
|---|---|
| `GET /health` | estado y versión del dataset |
| `GET /regions` | AOIs predefinidas con nombre, bbox y justificación |
| `GET /calendar?region=&bbox=&start=&end=` | matriz meses × años con valor armonizado, crudo, mediana y anomalía |
| `GET /detections?region=&bbox=&start=&end=` | CSV en streaming de las detecciones del rango |
| `GET /method` | tabla de calibración, estadísticas de validación y limitaciones (JSON estático) |

### 13.5 Stack cerrado

| Capa | Elección |
|---|---|
| Ingesta y ETL | Python 3.11+, `requests`, `pandas`, `pyarrow` |
| Almacén | Parquet + **DuckDB** (sin base de datos servida) |
| API | FastAPI + Uvicorn |
| Frontend | Next.js + TypeScript + Tailwind + Plotly (calendario y series) + MapLibre (mapa) |
| Deploy | Vercel (web) + Railway/Render/Fly (api) |

Alternativas descartadas: Django (superficie innecesaria), Streamlit (UI débil, no componentizable),
frontend 100% estático sin backend (el grid no entra en el navegador), backend que consulta FIRMS en
runtime (límite de 5 días y 5000 transacciones).

### 13.6 Referencia de armonización: usar **Aqua MODIS** como escala

La órbita vespertina de Aqua (~13:30 local) es la única que se mantiene continua desde 2002 y atraviesa
la era de todos los satélites VIIRS. Calibrar contra Aqua mantiene constante el ciclo diurno, que es
justamente lo que no controlás si comparás contra Terra (10:30) o contra un promedio de MODIS.

Ajuste al método de la sección 3: la razón de totales se calcula **por mes calendario, separando día y
noche, contra Aqua MODIS**, con suavizado tipo empirical Bayes para celdas con pocas muestras, y Terra
actúa solo como puente 2000–2002.

## 14. Inteligencia de competencia (2026)

Investigando el mismo desafío aparecieron:

- `Aalvee-Aarham/kiln-watch` — equipo de Bangladés. Mismo desafío 2026, ya publicado: FastAPI + React +
  MapLibre, **DuckDB leyendo GeoParquet remoto**, calibración por razón de totales con Aqua como
  referencia, test de "denial" (reconstruir la serie solo con VIIRS), intervalos de 95%, 9 regiones
  predefinidas y agente de IA. Declaran que 5 de 9 regiones caen dentro del rango de no-cambio, que
  Punjab sub-corrige ~7% y que Paraná Delta se va +27%.
- Discusión `nasa/spaceapps#1786` — varios equipos van por *matching espacio-temporal* y agrupación en
  "eventos de fuego" en lugar de calibración de totales.

**Implicancia estratégica:** el calendario global genérico ya está hecho por otros equipos. No conviene
competir en cantidad de features. El espacio libre está en **impacto local** (el Chaco, que es el crédito
de foto de CONAE), en el **flujo de trabajo del respondedor** y en **validación auditable** (tabla de
calibración descargable). Eso encaja exacto con las pistas B y C.

