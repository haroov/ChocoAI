
import flow from './backend/src/lib/flowEngine/builtInFlows/chocoClalSmbTopicSplitRouterFlow';

console.log('Flow Name:', flow.name);
console.log('Stage Keys:', Object.keys(flow.definition.stages));

const p01 = flow.definition.stages['p01_welcome_user'];
console.log('p01 nextStage:', p01?.nextStage);

const p02 = flow.definition.stages['p02_intent_segment_and_coverages'];
console.log('p02 exists:', !!p02);
console.log('p02 nextStage:', p02?.nextStage);
