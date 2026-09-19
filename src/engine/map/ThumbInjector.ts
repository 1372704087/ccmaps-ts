// Port of CNCMaps.Engine.Map.ThumbInjector
import type { DrawingSurface } from '../../rendering/DrawingSurface.js';
import type { IniFile } from '../../formats/IniFile.js';
import { Format5 } from '../../formats/encodings/Format5.js';

export class ThumbInjector {
  static InjectThumb(preview: DrawingSurface, map: IniFile): void {
    // the game stores the preview as RGB
    const image = new Uint8Array(preview.Width * preview.Height * 3);
    let idx = 0;
    for (let y = 0; y < preview.Height; y++) {
      const row = y * preview.Width * 3;
      for (let x = 0; x < preview.Width; x++) {
        image[idx++] = preview.data[row + x * 3 + 2]; // r
        image[idx++] = preview.data[row + x * 3 + 1]; // g
        image[idx++] = preview.data[row + x * 3]; // b
      }
    }

    // encode
    const imageCompressed = Format5.Encode(image, 5);

    // base64 encode
    const imageBase64 = Buffer.from(imageCompressed).toString('base64');

    // now overwrite [Preview] and [PreviewPack], inserting them directly after [Basic] if not yet existing
    map.getOrCreateSection('Preview').setValue('Size', `0,0,${preview.Width},${preview.Height}`);

    const section = map.getOrCreateSection('PreviewPack', 'Preview');
    section.clear();
    section.Index = 0;

    let rowNum = 1;
    for (let i = 0; i < imageBase64.length; i += 70) {
      section.setValue((rowNum++).toString(), imageBase64.substring(i, Math.min(70, imageBase64.length - i)));
    }
  }
}
