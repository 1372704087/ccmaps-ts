#!/usr/bin/env node
// Node CLI entry point for cncmaps-ts.
import { logger } from './shared/Log.js';
import { EngineResult } from './shared/Enums.js';
import { RenderSettings } from './shared/RenderSettings.js';
import { RenderEngine } from './engine/RenderEngine.js';

function main(): number {
  const args = process.argv.slice(2);
  const settings = new RenderSettings();
  settings.ConfigureFromArgs(args);

  if (settings.ShowHelp || settings.InputFile === '') {
    console.log('CNCMaps TS - C&C map renderer');
    console.log('');
    console.log('Usage: cncmaps --infile=MAPFILE [options]');
    console.log('');
    console.log(settings.GetHelpText());
    return settings.ShowHelp ? 0 : 1;
  }

  try {
    const engine = new RenderEngine();
    const result = engine.Render(settings);
    switch (result) {
      case EngineResult.RenderedOk:
        logger.info('Done');
        return 0;
      case EngineResult.LoadTheaterFailed:
        logger.fatal('Theater load failed; check the mix directory path and engine selection.');
        return 1;
      default:
        return 1;
    }
  } catch (e) {
    logger.fatal(`Unhandled exception: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    return 1;
  }
}

process.exit(main());