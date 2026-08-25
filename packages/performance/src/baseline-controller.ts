/** Self-contained validation/comparison surface used by the paired CI controller. */
export {
  capturePerformanceBaseline,
  comparePerformanceBaseline,
  formatGitHubError,
  validateBaselinePolicy,
  validateObservationSet,
} from './baseline.js';
export { validatePerformanceReport } from './report-schema.js';
