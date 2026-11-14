# Firetrack — Armonización de hotspots MODIS y VIIRS

**Evento:** NASA Space Apps Challenge 2026
**Equipo:** 3 personas — ingeniería de software (dev), ingeniería mecánica, ingeniería industrial
**Ventana real:** sábado 11:00 → domingo 17:00 (30 h de reloj, ~21 h de trabajo efectivo)
**Estado:** definición del problema. El esqueleto de código existe; no hay datos procesados todavía.
**Idioma:** documento de trabajo del equipo. La entrega, la presentación y el README final van en inglés.

> Documento canónico: este archivo es el que el equipo edita durante el hackathon.
> `docs/problem.md` es la versión en inglés para el jurado y se regenera desde acá antes del cierre.
> Si hay divergencia, manda este.
>
> Este documento integra el aporte del equipo en `FIRST EXPLANATION` (ver §16) con la verificación
> técnica hecha sobre las fuentes de NASA.

---

## 1. El problema

Los satélites llevan más de 20 años detectando focos de calor activos (incendios forestales y quemas
agrícolas). Pero ese registro está dividido entre dos sensores que no se pueden comparar directamente:

- **MODIS** (satélites Terra y Aqua): tiene la serie más larga, desde principios de los 2000, pero está
  llegando al final de su vida útil. Sus píxeles son de unos 1 km.
- **VIIRS**: es el sucesor. Da más detalle (375 m), pero empieza en 2012 y tiene otra sensibilidad y
  otros horarios de paso. Si juntás los conteos sin ajustar, aparece un salto artificial en 2012, y esa
  diferencia **cambia según la estación**, así que no basta con un solo factor de corrección.

La consecuencia operativa es concreta: hoy nadie puede responder con honestidad "¿este mes fue
inusualmente activo?" sobre la serie combinada. El salto de 2012 es del instrumento, no del territorio.

## 2. Lo que piden (en dos fases)

1. **Armonizar** los focos de MODIS y VIIRS, para que no importe de qué sensor viene el dato y lo
   importante sean los patrones, tendencias y anomalías.
2. **Hacer una aplicación web** que use esos datos armonizados. El usuario elige una zona y un rango de
   fechas y obtiene:
   - Un **calendario de actividad de quemas** (número de focos por mes y año, desde los 2000 hasta hoy).
   - Qué meses y qué años tuvieron más fuego.
   - Una comparación del mes actual con la **mediana histórica**.
   - Escalas de color accesibles.
   - Descarga en **CSV** de los focos encontrados.

### 2.1 Contrato de salidas

| # | Salida | Dónde lo pide |
|---|---|---|
| O1 | Calendario de actividad de quema, inicios de 2000 → presente, armonizado | "A calendar of burning activity ... a view of the fire history" |
| O2 | Qué épocas del año tienen más fuego / qué años tuvieron más actividad | mismo párrafo |
| O3 | Mes actual vs mediana histórica | "compare the burning activity of the current month against the historical median" |
| O4 | Selección de región (dibujar AOI, o lat/lon) | "Potential Considerations" |
| O5 | Rampas de color accesibles | "Consider using accessible color ramps" |
| O6 | Descarga CSV de los hotspots de la búsqueda | "A downloadable CSV File of hot spots detected during a search" |
| O7 | Anomalías contra promedios multianuales | "Historical comparisons, including anomalies against multi-year averages" |

### 2.2 Sugerencias opcionales del reto

- Usuarios objetivo: servicios de alerta temprana y emergencias, científicos, gestores del territorio
  y bomberos.
- Un mapa interactivo donde se pueda dibujar la zona, o meter latitud y longitud.
- Pocos indicadores pero claros: anomalías frente a medias de varios años y número de incendios
  detectados.

### 2.3 Recursos

La pestaña Resources del reto trae un solo enlace: **[FIRMS – NASA Earthdata](https://www.earthdata.nasa.gov/data/tools/firms)**,
la fuente de los focos de MODIS y VIIRS. En el foro de Space Apps un participante estima el histórico
global en unos **45 GB en CSV**. Por eso tiene sentido limitarse a regiones en lugar de procesar todo el
planeta `[ESTIMACIÓN DE TERCEROS, no verificada por nosotros]`.

Ojo con el enlace: es una **ficha de catálogo**, no una API. La API real está en
`firms.modaps.eosdis.nasa.gov/api/area/` y requiere `MAP_KEY` (ver §5).

## 3. Acotado propuesto

Ideas de acotado, ya ajustadas a las 30 h reales y a lo que la API permite:

- **Centrarse en regiones concretas**, no en el planeta entero. Candidatas: la península ibérica
  (Aragón como caso local del equipo) y el Chaco (crédito de foto de CONAE en el enunciado). Las dos
  están en `data/regions.json`.
- **Armonizar con un método sencillo pero defendible:** factor por mes calendario calculado en el
  periodo en que los dos sensores coinciden, aplicado a la serie completa. El refinamiento está en §4.
- **Web con mapa, mapa de calor de meses por años y botón de exportar CSV.** Stack en §13.

La elección de la región del demo es una decisión abierta de las pistas B y C (§12, D6): el Chaco da
relato local argentino; Iberia/Aragón da cercanía con el equipo y audiencia europea.

## 4. El núcleo técnico

Los conteos crudos de hotspots son un artefacto del instrumento, no del fuego:

| Propiedad | MODIS (Terra, Aqua) | VIIRS (S-NPP, NOAA-20, NOAA-21) |
|---|---|---|
| Píxel nominal | 1 km | 375 m (banda I), agregado a ~750 m |
| Satélites en el registro | 2 (ambos al final de su vida útil) | 3 (S-NPP 2012→2026, NOAA-20 2018→, NOAA-21 2023→) |
| Pasadas por día | 2 por satélite (~10:30/22:30, ~13:30/01:30 local) | 2 por satélite, ~13:30/01:30 local |
| Inicio del registro | nov 2000 | ene 2012 |
| Campo de confianza | `confidence` 0–100 (numérico) | `confidence` l / n / h (categórico) |
| Detecciones efectivas | menos, píxeles más gruesos | del orden de 3–10× más por el mismo complejo de fuego `[MEDIR]` |

### 4.1 Estrategias candidatas

| ID | Estrategia | A favor | En contra |
|---|---|---|---|
| H1 | Grilla gruesa + normalización por oportunidad de observación | principalista | requiere contar pasadas válidas, que FIRMS no entrega limpio |
| H2 | **Calibración por ventana de solapamiento** (razón de totales por mes calendario) | responde directo al problema, demostrable | necesita muestras suficientes por celda |
| H3 | **Presencia binaria** por celda-mes (hubo / no hubo fuego) | casi independiente del sensor, barato | pierde intensidad |
| H4 | Conteos ponderados por FRP o filtrados por confianza | físicamente significativo | sigue sesgado por resolución |

**Elección:** H2 como serie primaria, H3 como control de sanidad independiente, ambas a grilla de
**0.25° y 1°**, resolución mensual. Se entrega como *índice de actividad armonizado*, nunca como
"cantidad de incendios". Los conteos nativos quedan en el CSV con columna `sensor`.

### 4.2 Referencia: **Aqua MODIS**, no un promedio

El aporte del equipo sobre la estacionalidad es correcto y es la razón por la que el factor va **por mes
calendario y no como una constante**. El refinamiento es contra qué se calibra: la órbita vespertina de
Aqua (~13:30 local) es la única continua desde 2002 y atraviesa la era de todos los satélites VIIRS.
Calibrar contra Aqua mantiene constante el ciclo diurno. Calibrar contra Terra (10:30) o contra un
promedio de MODIS mezcla cambio de sensor con cambio de hora de observación.

Detalle de implementación: razón de totales por mes calendario, **día y noche separados**, con suavizado
tipo empirical Bayes para celdas con pocas muestras. Terra actúa solo como puente 2000–2002.

## 5. Datos — plan verificado (2026-11-14)

### 5.1 `MAP_KEY`

Clave gratuita atada a un email. Se pide en `firms.modaps.eosdis.nasa.gov/api/map_key/`, llega por
correo y autentica la API de área y los map services. No es usuario ni suscripción.

- Límite: **5000 transacciones / 10 min**; un pedido de N días cuesta ~N transacciones.
- Si el email ya está registrado, el formulario no reenvía la clave: se administra desde el portal de descarga.
- Es una credencial: vive en `.env` (gitignored), nunca en el repo.

### 5.2 Cobertura real por producto

| Producto | Cobertura |
|---|---|
| MODIS C6.1 (SP) | 2000-11-01 → presente (~5 meses de rezago) |
| VIIRS S-NPP 375 m (SP) | 2012-01-20 → **2026-11-02 (terminado)** |
| VIIRS NOAA-20 375 m (SP) | 2018-04-01 → presente |
| VIIRS NOAA-21 375 m (SP) | 2023-03-01 → presente |

**Hallazgo crítico:** S-NPP ya no entrega datos. Con S-NPP solo, la serie no llega a "hoy": la cola
reciente necesita NOAA-20 y `_NRT` para los últimos meses.

### 5.3 Ingesta elegida (sin cuenta Earthdata)

API de área por bloques de 5 días (`DAY_RANGE` máximo), sobre AOIs acotadas:

- ~1900 pedidos por sensor por AOI para 25 años. El pipeline es **idempotente y reanudable** por
  `(aoi, sensor, ventana)`: si se corta, no vuelve a bajar lo que ya tiene.
- Presupuesto medido con `scripts/budget.py`:

| Regiones | Transacciones | Horas de reloj esperando el límite |
|---|---|---|
| 1 | 19.416 | ~0,6 h |
| 3 | 58.248 | ~1,9 h |
| 9 | 174.744 | ~5,8 h |

- **Conclusión de alcance:** una región entra en 40 minutos de espera; tres regiones es el techo
  razonable. Nueve no entra sin comerse el domingo.

### 5.4 Archivo histórico (rechazado para hoy)

Requiere Earthdata Login o código por email, permite **un año global por pedido** y la entrega es
**asíncrona por email**. Es la vía correcta para "todo el planeta", pero no es viable en 30 h. Queda como
plan B y como fuente de un año de validación cruzada.

### 5.5 Consecuencia de alcance

- **Primario:** regiones predefinidas con calendario completo 2000 → presente.
- **Secundario:** AOI arbitraria en modo "cobertura limitada" (ventana corta, declarada en la UI).
- **Descartado:** grilla global 0.25° completa. Un grid mensual global son ~1,04 M celdas × 300 meses:
  es un backend, no algo que se pueda enviar al navegador.

### 5.6 Campos a armonizar

Comunes: `latitude`, `longitude`, `acq_date`, `acq_time`, `satellite`, `instrument`, `frp`, `daynight`, `type`.
Divergentes: `brightness`/`bright_ti4`, `bright_t31`/`bright_ti5`, `scan`, `track`, `confidence` (0–100 vs l/n/h), `version`.
Esquema unificado: `sensor`, `platform`, `pixel_km`, `confidence_score` (0–1 normalizado), `frp`, `datetime_utc`, `cell_id`.

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
- **S10** Puerta de calidad: durante la ventana de solapamiento, el índice calibrado reproduce la serie nativa de Aqua MODIS dentro de una tolerancia declarada; el gráfico que lo prueba está en el repo y enlazado desde la app.

## 7. Alcance

**Imprescindible:** dataset precomputado (2000→presente, MODIS + VIIRS); selección de AOI y rango;
calendario mes × año con rampa accesible; estacionalidad y totales por año; comparación con mediana
histórica y anomalía; descarga CSV; panel de procedencia.

**Deseable:** capa de mapa con los hotspots; regiones predefinidas; URL compartible; alternar FRP.

**Fuera de alcance (v1):** dibujo libre de polígonos; cuentas de usuario; streaming más allá de la cola
reciente; armonización píxel a píxel.

## 8. Guion del demo (5 minutos)

1. Elegir la región del demo con el registro completo.
2. El calendario se llena: banda de estación seca visible, 2024 vs 2005 **sin** el salto artificial de sensor.
3. Pasar el mouse por un mes: valor, mediana, anomalía.
4. Cambiar a estacionalidad y totales anuales.
5. Descargar el CSV en vivo.
6. Mostrar el gráfico de calibración y declarar la limitación en voz alta.

## 9. Riesgos

| ID | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| R1 | Cuenta o volumen del archivo histórico bloquean la ingesta | mata la armonización | la ingesta elegida no lo necesita (§5.3); el archivo queda como plan B |
| R2 | La armonización no resulta creíble | entrega débil | índice + gráfico de validación + límites declarados (S8, S10) |
| R3 | Scope creep hacia polígonos / auth / datos en vivo | no hay demo | solo bbox, presets, datos precomputados |
| R4 | Un solo desarrollador para datos + web | cuello de botella | pipeline primero, UI después; B y C cargan con validación, requisitos, QA y entrega |
| R5 | Confianza de VIIRS categórica vs MODIS numérica | filtrado silencioso | `confidence_score` único, con test unitario (ya implementado) |
| R6 | Corrimiento de fecha por `acq_date` + `acq_time` | meses corridos en el calendario | `datetime_utc` en el esquema unificado, con test unitario (ya implementado) |
| R7 | Límite de 5000 transacciones / 10 min | ingesta incompleta | presupuesto medido (§5.3) y cache reanudable |

## 10. Reparto de trabajo

| Pista | Dueño | Es dueño de | Terminado cuando |
|---|---|---|---|
| **A. Datos y software** | Ing. de software | Pipeline (ingesta → normalización → grilla → armonización → artefactos), API, frontend del calendario y gráficos, CSV | S1–S9 pasan sobre el AOI del demo; el repo reproduce el dataset desde scripts |
| **B. Validación física** | Ing. mecánico | Geometría de pasada, footprint según ángulo de escaneo, umbrales de detección, significado del FRP; metodología de calibración; validación contra eventos conocidos (Amazonía 2019, Australia 2019–20, Canadá 2023); `docs/method.md` | Método calibrado con gráfico de validación sobre eventos reales, más supuestos físicos y modos de falla por escrito |
| **C. Producto y entrega** | Ing. industrial | Usuario y recorrido del respondedor, definición operativa de "anomalía", plan y checklist de QA, registro de riesgos, texto de entrega, guion del demo, video, README para el jurado | Requisitos firmados, QA ejecutada antes de cada corrida, materiales listos 90 min antes |

Por qué los no-devs tienen trabajo real: el reto se gana o se pierde en **credibilidad del método y
comunicación**, no en CRUD.

## 11. Cronograma (30 h de reloj)

| Bloque | Horario | Objetivo | Dueño |
|---|---|---|---|
| **B0 Arranque** | Sáb 11:00–12:30 | D1–D6 cerradas, stack fijado, repo listo | Todos |
| **B1 Auditoría de datos** | Sáb 12:30–15:00 | `MAP_KEY`, probe cronometrado, un AOI cargado con 3 sensores | A (B en paralelo) |
| **B2 Pipeline v0** | Sáb 15:00–21:00 | dataset normalizado + grilla armonizada, gráfico de calibración | A |
| **B2b Paralelo** | Sáb 15:00–21:00 | `docs/method.md` y eventos de validación / requisitos congelados y guion | B / C |
| **Cena + sync (G1)** | Sáb 21:00–22:00 | revisión de puerta | Todos |
| **B3 Núcleo de la app** | Sáb 22:00–Dom 02:00 | AOI + rango → calendario + mediana con datos reales | A |
| **Descanso** | Dom 02:00–08:00 | dormir, obligatorio | Todos |
| **B4 Validación + QA** | Dom 08:00–12:00 | S10 validado, CSV, panel de procedencia, QA ejecutada | B/C + A |
| **B5 Pulido + deploy** | Dom 12:00–15:00 | estacionalidad, mapa, accesibilidad, URL pública | A |
| **B6 Entrega** | Dom 15:00–16:30 | video, README, formulario, ensayo | C |
| **Margen** | Dom 16:30–17:00 | buffer, nada nuevo | Todos |

### Puertas de decisión (se recorta, no se estira)

- **G0 — Sáb 12:30.** Sin stack ni decisiones, mínimo: pipeline Python + app de una página.
- **G1 — Sáb 21:00.** Sin grilla armonizada, se recorta a MODIS + S-NPP con calibración global y se sigue.
- **G2 — Dom 02:00.** Si el calendario no se dibuja con datos reales, el domingo se invierte en eso y se eliminan mapa, estacionalidad y presets.
- **G3 — Dom 12:00.** Si faltan CSV o panel de procedencia, prioriza el CSV: es requisito explícito.
- **G4 — Dom 15:00.** Congelamiento de código.

## 12. Decisiones

| ID | Decisión | Motivo |
|---|---|---|
| **D1** | Monorepo `apps/web` + `services/api` + `pipeline/` + `data/` | El pipeline no es el backend |
| **D2** | Regiones predefinidas con registro completo; AOI arbitraria en modo limitado | La ingesta por API no cubre el planeta en 30 h |
| **D3** | `MODIS_SP` + `VIIRS_SNPP_SP` + `VIIRS_NOAA20_SP` (+ NRT en la cola) | S-NPP termina el 2026-11-02 |
| **D4** | Commitear solo agregados, nunca detecciones crudas | Tamaño de repo vs reproducibilidad |
| **D5** | Next.js en Vercel; FastAPI en Railway/Render/Fly | Dos despliegues simples y gratuitos |
| **D6** | **Región del demo:** Chaco vs Iberia/Aragón — `[ABIERTA]` | Chaco = relato CONAE; Iberia = cercanía del equipo |

## 13. Stack

```
apps/web/          Next.js + TypeScript + Tailwind + Plotly + MapLibre
services/api/      FastAPI + DuckDB
pipeline/          Python: ingesta → normalización → grilla → armonización
data/              regions.json + artefactos (crudos y Parquet ignorados por git)
```

**FastAPI y no Django:** es un servicio de lectura analítica con 5 endpoints. Sin auth, sin admin, sin
migraciones, sin ORM. DuckDB sobre Parquet es una consulta SQL; FastAPI da `/docs` automático, que
también es material de demo.

**Next.js sí, con una condición:** la lógica de datos **no** vive en `app/api/*` ni en Server
Components. DuckDB en serverless es una trampa. Next es presentación; FastAPI es datos.

**Contrato de la API:** `/health`, `/regions`, `/calendar`, `/detections`, `/method`. Devuelve `503` con
mensaje accionable cuando falta un artefacto: un gráfico vacío que parece "no hubo incendios" es peor que
un error honesto.

## 14. Competencia (2026)

- `Aalvee-Aarham/kiln-watch` — equipo de Bangladés, mismo reto ya publicado: FastAPI + React + MapLibre,
  DuckDB sobre GeoParquet remoto, calibración con Aqua como referencia, test de "denial", intervalos de
  95%, 9 regiones y agente de IA. Declaran 5 de 9 regiones dentro del rango de no-cambio, Punjab ~7% por
  debajo y Paraná Delta +27%.
- `nasa/spaceapps#1786` — varios equipos van por *matching espacio-temporal* y agrupación en "eventos de
  fuego" en lugar de calibración de totales.

**Implicancia:** el calendario global genérico ya está hecho. No conviene competir en cantidad de
features. El espacio libre es impacto local, flujo del respondedor y validación auditable.

## 15. Próximas acciones

1. Pedir el `MAP_KEY` y correr `scripts/check_firms.py` para medir latencia real.
2. Medir volumen de filas por sensor-año y fijar la grilla con evidencia.
3. Generar el primer `calendar.json` real de un AOI y recién ahí empezar la UI.
4. Congelar S1–S10; todo lo nuevo va a "Deseable".

## 16. Registro de aportes

- **`FIRST EXPLANATION`** (commit `e8d8253`, equipo): resumen del reto, la observación de que la
  diferencia entre sensores **cambia según la estación** y que por eso no basta un factor único, el
  enlace de FIRMS, la estimación de 45 GB y la propuesta de acotar a una región con método de factor
  mensual. Su texto se conserva en §1, §2 y §3; la observación estacional es la justificación del factor
  por mes calendario de §4. El archivo suelto se eliminó al quedar integrado acá.
- **Verificación técnica** (commit `67324a0`): `DAY_RANGE` 1–5, `MAP_KEY` y su límite, cobertura real
  por sensor incluido el fin de S-NPP el 2026-11-02, presupuesto de transacciones medido, contrato de
  requisitos, riesgos, cronograma con puertas y stack.
