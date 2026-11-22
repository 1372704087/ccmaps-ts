// Reads basic [Basic] / [Map] metadata from a local map file without
// uploading it. Map files are INI text with base64-packed sections, so a
// bounded prefix is enough for the metadata we show in the UI.
(function () {
  'use strict';

  function parseSections(text) {
    const sections = new Map();
    let current = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith('[') && line.endsWith(']')) {
        current = line.slice(1, -1).trim().toLowerCase();
        sections.set(current, new Map());
        continue;
      }
      if (!current || line === '' || line.startsWith(';')) continue;
      const eq = line.indexOf('=');
      if (eq > 0) {
        sections.get(current).set(line.slice(0, eq).trim().toLowerCase(), line.slice(eq + 1).trim());
      }
    }
    return sections;
  }

  function number(value) {
    const n = parseInt(String(value || '').replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  }

  async function readMapInfo(file) {
    const prefix = await file.slice(0, 1024 * 1024).arrayBuffer();
    const text = new TextDecoder('latin1').decode(prefix);
    const sections = parseSections(text);
    const basic = sections.get('basic') || new Map();
    const map = sections.get('map') || new Map();
    const size = String(map.get('size') || '').split(',');
    return {
      name: basic.get('name') || '',
      author: basic.get('author') || '',
      width: number(size[0]),
      height: number(size[1]),
      players: number(basic.get('maxplayers')),
      theater: map.get('theater') || '',
    };
  }

  window.CncmapsMapInfo = { read: readMapInfo };
})();
