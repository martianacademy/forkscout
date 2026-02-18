/**
 * Survival system barrel — re-exports all public types and the createSurvivalMonitor factory.
 *
 * @module survival
 */

export type {
    ThreatLevel,
    VitalSign,
    ThreatEvent,
    SurvivalStatus,
    SurvivalConfig,
    SurvivalMonitor,
    BatteryParseResult,
    ResolvedSurvivalConfig,
} from './types';

export { createSurvivalMonitor } from './monitor';
