// STL binario a partir de la malla de manifold (vertProperties / triVerts).

export function buildBinarySTL(vertProperties, triVerts) {
  const triCount = triVerts.length / 3;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triCount, true);

  const gv = (i) => [vertProperties[i * 3], vertProperties[i * 3 + 1], vertProperties[i * 3 + 2]];

  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    const a = gv(triVerts[t * 3]), b = gv(triVerts[t * 3 + 1]), c = gv(triVerts[t * 3 + 2]);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    view.setFloat32(offset, nx, true); view.setFloat32(offset + 4, ny, true); view.setFloat32(offset + 8, nz, true);
    offset += 12;
    for (const pt of [a, b, c]) {
      view.setFloat32(offset, pt[0], true); view.setFloat32(offset + 4, pt[1], true); view.setFloat32(offset + 8, pt[2], true);
      offset += 12;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return buffer; // ArrayBuffer (en el navegador se envuelve en Blob; en Node, en Buffer)
}
