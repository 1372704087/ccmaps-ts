// Worker-thread entry for parallel streamed rendering: re-creates the render engine against
// the same map and draws the strips assigned to this worker.
import * as fs from 'node:fs';
import { RenderEngine } from '../RenderEngine.js';
import { RenderSettings } from '../../shared/RenderSettings.js';
import { EngineResult } from '../../shared/Enums.js';

interface BandWorkerData {
  entryUrl: string;
  errorFile: string;
  control: SharedArrayBuffer;
  workerIndex: number;
  workerCount: number;
  settings: Record<string, unknown>;
  bandJob: NonNullable<RenderSettings['BandJob']>;
  metadataFile: string;
}

export function runBandWorker(data: BandWorkerData): void {
  const ctl = new Int32Array(data.control);
  try {
    const settings = new RenderSettings();
    Object.assign(settings, data.settings);
    // the parent process owns progress reporting and diagnostics
    settings.ProgressSink = null;
    settings.StatsSink = null;
    settings.OutputSink = null;
    settings.ReportProgress = false;
    settings.MetadataOutFile = data.workerIndex === 0 ? data.metadataFile : '';
    settings.BandJob = data.bandJob;
    settings.BandJobControl = ctl;

    const result = new RenderEngine().Render(settings);
    if (result !== EngineResult.RenderedOk) {
      throw new Error(`band worker ${data.workerIndex} failed: ${EngineResult[result]}`);
    }
    Atomics.store(ctl, 2 + data.workerIndex, 100);
  } catch (e) {
    try { fs.writeFileSync(data.errorFile, String(e instanceof Error ? (e.stack ?? e.message) : e)); } catch { /* ignore */ }
    Atomics.store(ctl, 1, 1);
  } finally {
    Atomics.add(ctl, 0, 1);
    Atomics.notify(ctl, 0);
  }
}
