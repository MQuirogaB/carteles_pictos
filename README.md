# Carteles con pictogramas

Generador online de **carteles con pictogramas de ARASAAC y braille en relieve** (derivado de [Cartel braille](https://github.com/MQuirogaB/cartel_braille)), listos para imprimir en 3D.
Escribes un texto, ves la placa en 3D y descargas el `.stl`. Todo ocurre en el
navegador: no se sube nada a ningún servidor.

- Braille **español, grado 1** (letra a letra): mayúsculas (`⠠`, y `⠠⠠` para
  palabras enteras en mayúsculas), números (signo `⠼`), `ñ`, vocales acentuadas,
  `ü` y puntuación habitual.
- Medidas por defecto **Marburg Medium**: punto de 1,5 mm, 2,5 mm entre puntos,
  6 mm entre celdas y 10 mm entre líneas. Todas se pueden ajustar.
- Placa con esquinas redondeadas opcionales y **dos agujeros de fijación**
  opcionales.
- Ajuste automático de línea (celdas máximas por línea) y saltos de línea propios.
- **Modo por lotes**: un cartel por línea (o separados por una línea en blanco) →
  un ZIP con un STL por cartel y un `lista.csv` con el índice. Barra de progreso,
  botón de abortar y resumen de errores por cartel. Los ajustes de placa y puntos
  valen para todo el lote.
- **Pictogramas opcionales** ([ARASAAC](https://arasaac.org)): se busca por palabra, se
  elige uno y se imprime en relieve sobre la placa (encima del texto o a la izquierda),
  útil para rutinas y agendas visuales. También se puede subir una imagen propia. En el
  modo por lotes se busca solo con el texto de cada cartel; para elegir otro se escribe
  `Levantarse | despertarse` o `Levantarse | #6964` (número de ARASAAC). Si no se
  encuentra o falla la conexión, ese cartel se genera sin pictograma y se avisa.
- Estética de [miguelquiroga.es](https://miguelquiroga.es) (fondo blanco, acento violeta,
  títulos en serif).

## Uso

Abre `docs/index.html` servido por HTTP (por ejemplo `npx serve docs`) o publica
la carpeta `docs/` con GitHub Pages (*Settings → Pages → Branch: main, /docs*).

## Tests

```bash
npm install
npm test
```

Comprueba la tabla braille, el ajuste de línea y que la malla generada es válida
(sin asas inesperadas y con la altura esperada).

## Limitaciones

- Solo grado 1: no hay abreviaturas (grado 2).
- Tras un número, una letra de la `a` a la `j` no lleva signo de letra intermedio.
- Los pictogramas necesitan conexión a ARASAAC (o una imagen propia) y su licencia es
  **CC BY-NC-SA 4.0** (Gobierno de Aragón, autor Sergio Palao): uso no comercial,
  citando la fuente y compartiendo las adaptaciones igual. El ZIP incluye
  `LICENCIA-ARASAAC.txt` cuando se usan.
- Los caracteres sin equivalente (por ejemplo `€`) se omiten y se avisa en la página.

## Estructura

- `docs/braille.js`: texto → celdas braille y maquetación.
- `docs/plate.js`: medidas, posición de los puntos y construcción del sólido.
- `docs/generate.js`: genera un cartel (malla + STL) a partir de texto y parámetros.
- `docs/batch.js`: parte el texto del lote en carteles y calcula los nombres de archivo.
- `docs/picto.js`: búsqueda en ARASAAC y conversión de imagen a relieve (contornos).
- `docs/stl.js`: STL binario.
- `docs/app.js`: interfaz (modo simple y por lotes), vista previa 3D y descargas.
- `docs/style.css`: estilos.
