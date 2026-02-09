# Add this flow to your builtInFlows index

This file is auto-generated guidance for integrating the flow.

## 1) Copy file

Place:

- `backend/src/lib/flowEngine/builtInFlows/chocoClalSmbTopicSplitRouterFlow.ts`

into your repo at the same path.

## 2) Register the flow in your builtInFlows registry

Find the file that exports the built-in flows map/registry, e.g.:

- `backend/src/lib/flowEngine/builtInFlows/index.ts`
- or `backend/src/lib/flowEngine/builtInFlows/builtInFlows.ts`

Then add:

```ts
import chocoClalSmbTopicSplitRouterFlow from './chocoClalSmbTopicSplitRouterFlow';

export const builtInFlows = {
  // ...
  chocoClalSmbTopicSplitRouter: chocoClalSmbTopicSplitRouterFlow,
};
```

## 3) Run E2E

Start a conversation with flow slug/key:

- `chocoSmbTopicSplitRouter`

Initial stage:

- `p01_welcome_user`
