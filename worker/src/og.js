// SVG -> PNG with resvg (WebAssembly). Fonts are bundled so text renders identically everywhere.
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import regular from '../fonts/DejaVuSans.ttf';
import bold from '../fonts/DejaVuSans-Bold.ttf';

let ready = null;

export async function renderPNG(svg) {
  if (!ready) ready = initWasm(resvgWasm).catch((err) => { ready = null; throw err; });
  await ready;
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: {
      fontBuffers: [new Uint8Array(regular), new Uint8Array(bold)],
      defaultFontFamily: 'DejaVu Sans',
      loadSystemFonts: false,
    },
  });
  const png = resvg.render().asPng();
  resvg.free();
  return png;
}
