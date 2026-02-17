/**
 * Situation system — barrel re-exports.
 *
 * Provides a single entry point for the domain-aware situation classifier.
 * Consumers import from `'./situation'` (resolves to this index).
 *
 * @module situation
 */

// Types and constants
export type {
    BuiltInDomain,
    LifeDomain,
    DomainDescriptor,
    SituationModel,
    AccessContext,
} from './types';
export { BUILT_IN_DOMAINS, ENTITY_DOMAIN_AFFINITY } from './types';

// Domain registry
export { registerDomain, getDomain, listDomains, domainCount } from './registry';

// Situation classifier
export { classifySituation, buildAccessContext } from './classifier';

// Domain boosting
export { domainBoost, observationDomainBoost } from './boost';
