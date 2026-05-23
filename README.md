# Marte MOLA 3D

Proyecto web estatico para explorar Marte como malla 3D con elevacion real del dataset NASA PDS MGS MOLA MEGDR.

## Ejecutar

```bash
python3 -m http.server 5173
```

Abre `http://localhost:5173`.

## Datos

- Fuente: `MGS-M-MOLA-5-MEGDR-L3-V1.0`, producto `MEGT90N000EB.IMG`.
- Instrumento: Mars Orbiter Laser Altimeter (MOLA), Mars Global Surveyor.
- Resolucion original usada: 16 pixeles/grado, topografia en metros.
- Derivado local: `data/mars-mola-1440x720-int16le.bin`, reducido a 4 pixeles/grado por promedio de bloques 4x4.
- El relieve puede verse en escala 1x real o exagerarse visualmente. El calculo de inundacion usa siempre metros reales.
- La inundacion se calcula sobre la grilla MOLA derivada completa `1440x720`, no sobre la malla visible, para que el porcentaje no cambie al alternar Baja/Media/Alta.
- `Costa realista` conserva el oceano principal y lagos grandes, y descarta depresiones aisladas pequenas. El umbral de lagos es `80,000 km2`.
- `Bordes suaves` mezcla costa humeda/playa entre `0-1200 m` sobre el nivel del mar y reduce cortes duros entre tierra y agua.
- `Nieve por altura` anade una capa visual tipo terrestre sobre montanas altas, con transicion gradual desde unos 6.2 km y ajuste por pendiente.
- `Hielo polar` anade hielo por latitud cuando la nieve esta activa, empezando cerca de 70 grados norte/sur.
- `Earth-like` es el modo visual terraformado; `Mars raw` conserva una lectura mineral mas marciana.
- `Atlas` usa una paleta cartografica fisica para leer mejor continentes, mares y tierras altas.
- `Biomas` mezcla costas humedas, interiores secos y roca de altura de forma visual, sin alterar la topografia ni el agua.
- `Detalle Ultra 1:1` usa la grilla MOLA derivada completa `1440x720` para el terreno; el agua se mantiene capada a Alta para evitar duplicar millones de parches sin aportar detalle visible.
- `Ultra creativo` conserva MOLA como base y anade microrelieve procedural determinista mas agresivo para detallismo extremo. Es una capa artistica, no medicion cientifica.
- `50%` busca automaticamente el nivel del mar mas cercano a media superficie inundada.
- La orientacion muestra ecuador, meridianos y polos; el mapa 2D equirectangular es clicable para enfocar la camara.
- Hay tours rapidos para mares, volcanes, canones y continentes, mas `Captura bonita` para una composicion cinematografica.
- `Rios por deshielo` simula cauces plausibles derivados de MOLA: las fuentes nacen de nieve/altura/polos, el flujo busca evacuar hacia la mayor masa de agua disponible segun el nivel del mar actual, los afluentes acumulan caudal y cada rio reporta longitud y anchura aproximadas. Usa un drenaje tipo priority-flood hacia oceano dominante, con meandro subcelular determinista para evitar cauces rectilineos de grilla. Es hidrologia Earth-like sintetica basada en MOLA, no rios observados.
- El calculo de inundacion corre en `src/flood-worker.js` con fallback en hilo principal si el worker no esta disponible.

## Regenerar el derivado

```bash
python3 scripts/process_mola.py
```
