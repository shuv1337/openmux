/**
 * Re-export from the worker-pool module
 * This file is kept for backwards compatibility with existing imports.
 */

export {
  EmulatorWorkerPool,
  getWorkerPool,
  initWorkerPool,
  type UpdateCallback,
  type TitleCallback,
  type ModeCallback,
} from './worker-pool/index';
