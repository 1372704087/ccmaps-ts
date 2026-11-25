#!/usr/bin/env node
// Node CLI entry point for cncmaps-ts.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger, LogLevel } from './shared/Log.js';
import { EngineResult } from './shared/Enums.js';
import { RenderSettings } from './shared/RenderSettings.js';
import { RenderEngine } from './engine/RenderEngine.js';
import { pixelHash } from './rendering/PngReader.js';

function writeFileWithDirs(file: string, data: string): void {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, data);
}

/** Writes the optional --pixel-hash / --bench-json diagnostics for a finished render. */
function writeRenderDiagnostics(settings: RenderSettings, elapsedMs: number, peakRss: number): void {
  if (settings.PixelHashFile === '' && settings.BenchJsonFile === '') return;
  const outPath = RenderEngine.resolveOutputPath(settings, path.basename(settings.InputFile));
  let outBytes = 0;
  try { outBytes = fs.statSync(outPath).size; } catch { /* output may be missing on failure */ }

  let hash: string | null = null;
  if (/\.png$/i.test(outPath)) {
    try {
      hash = pixelHash(outPath);
    } catch (e) {
      logger.warn(`Could not hash ${outPath}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (settings.PixelHashFile !== '') {
    if (hash == null) logger.warn('--pixel-hash needs a PNG output; no hash written');
    else writeFileWithDirs(settings.PixelHashFile, hash + '\n');
  }
  if (settings.BenchJsonFile !== '') {
    let cpuUserMs: number | null = null;
    let cpuSystemMs: number | null = null;
    try {
      const usage = process.resourceUsage();
      cpuUserMs = Math.round(usage.userCPUTime / 1000);
      cpuSystemMs = Math.round(usage.systemCPUTime / 1000);
    } catch { /* not available on every platform */ }
    const record = {
      map: path.basename(settings.InputFile),
      ms: Math.round(elapsedMs),
      rssMaxBytes: Math.round(peakRss),
      cpuUserMs,
      cpuSystemMs,
      outBytes,
      pixelHash: hash,
      format: settings.SavePSD ? 'psd' : settings.SaveJPEG && !settings.SavePNG ? 'jpg' : 'png',
      bandHeight: settings.BandHeight,
    };
    writeFileWithDirs(settings.BenchJsonFile, JSON.stringify(record, null, 2) + '\n');
  }
}

function main(): number {
  const args = process.argv.slice(2);
  const settings = new RenderSettings();
  settings.ConfigureFromArgs(args);
  if (settings.Debug && !logger.isEnabled(LogLevel.Debug)) logger.setLevel(LogLevel.Debug);

  if (settings.ShowHelp || settings.InputFile === '') {
    console.log('CNCMaps TS - C&C map renderer');
    console.log('');
    console.log('Usage: cncmaps --infile=MAPFILE [options]');
    console.log('');
    console.log(settings.GetHelpText());
    return settings.ShowHelp ? 0 : 1;
  }

  let peakRss = 0;
  const sampleRss = (): void => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  };
  sampleRss();
  const rssTimer = setInterval(sampleRss, 50);
  rssTimer.unref?.();
  const startedAt = process.hrtime.bigint();

  try {
    const engine = new RenderEngine();
    const result = engine.Render(settings);
    clearInterval(rssTimer);
    sampleRss();
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    switch (result) {
      case EngineResult.RenderedOk:
        writeRenderDiagnostics(settings, elapsedMs, peakRss);
        logger.info('Done');
        return 0;
      case EngineResult.LoadTheaterFailed:
        logger.fatal('Theater load failed; check the mix directory path and engine selection.');
        return 1;
      default:
        return 1;
    }
  } catch (e) {
    clearInterval(rssTimer);
    logger.fatal(`Unhandled exception: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    return 1;
  }
}

process.exit(main());
