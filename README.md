# Carteles con pictogramas

Generador online de **carteles con pictograma de [ARASAAC](https://arasaac.org) y texto, en SVG de un solo color**, listos para cortar y grabar con láser. Todo ocurre en el navegador: no se sube nada a ningún servidor.

## Qué hace

- **Un cartel**: buscas un pictograma por palabra (o subes tu propia imagen), escribes el texto y descargas el SVG.
- **Un solo color a tu elección** para todo el cartel. Opcionalmente, otro color para el contorno de corte.
- El cartel es una placa con esquinas redondeadas (y dos agujeros de fijación opcionales). El contorno y los agujeros son líneas finas (0,1 mm); el pictograma y el texto son formas rellenas.
- El texto va **convertido a trazados**, así no hace falta tener la letra instalada en el programa del láser. Letras incluidas: Atkinson Hyperlegible, Lexend, Nunito, Comic Neue, DejaVu Sans y DejaVu Serif (normal y negrita), o sube la tuya (.ttf, .otf, .woff).
- Tres estilos de pictograma: líneas (contorno y detalles), silueta rellena, o silueta con los detalles vaciados.
- Texto opcional, tamaños de pictograma, letra, margen, separación y esquinas ajustables (en mm).
- **Modo por lotes**: un cartel por línea (o separados por una línea en blanco) → un ZIP con un SVG por cartel, una `hoja.svg` con todos juntos y un `lista.csv`. Para elegir otro pictograma se escribe `Levantarse | despertarse` (busca esa palabra) o `Levantarse | #6964` (número de ARASAAC). Si no se encuentra o falla la conexión, ese cartel se genera sin pictograma y se avisa. Opción de dar el mismo tamaño a todos.

## Uso

Abre `docs/index.html` desde un servidor estático (por ejemplo `python3 -m http.server -d docs`) o usa la versión publicada en GitHub Pages. Los pictogramas necesitan conexión a ARASAAC; si no, se puede subir una imagen propia (PNG con fondo transparente, o dibujo oscuro sobre blanco).

## Tests

```bash
npm install
npm test
```

## Licencias

- Pictogramas: © Gobierno de Aragón, autoría de Sergio Palao, [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/): uso no comercial, citando la fuente y compartiendo las adaptaciones igual. El ZIP incluye `LICENCIA-ARASAAC.txt` cuando se usan.
- Letras: Atkinson Hyperlegible, Lexend, Nunito y Comic Neue bajo SIL Open Font License 1.1 (vía Fontsource); DejaVu bajo su licencia libre (Bitstream Vera).
- Derivado de [Cartel braille](https://github.com/MQuirogaB/cartel_braille).

## Estructura

- `docs/svg.js`: maqueta el cartel y genera el SVG (corte y grabado) y la hoja con varios.
- `docs/picto.js`: búsqueda en ARASAAC y conversión de imagen a contornos vectoriales.
- `docs/batch.js`: parte el texto del lote en carteles y calcula los nombres de archivo.
- `docs/app.js`: interfaz (modo simple y por lotes), vista previa y descargas.
- `docs/fonts/`: letras incluidas (normal y negrita).
