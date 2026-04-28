# Codex Subagent Timeline Support Design

Date: 2026-04-28
Status: approved design

## Goal

Add first-pass Codex native subagent visibility to HAPI without adding composer shortcuts or taking over Codex orchestration.

Users can ask Codex to use subagents naturally. HAPI should keep the main conversation readable by separating child/subagent output from the main assistant stream, while still making that output available in a folded subagent card.

## Non-goals

- No `/subagents` composer command.
- No prompt injection or canned delegation prompt.
- No sidebar parent/child thread tree.
- No separate subagent session page.
- No direct child-agent controls such as send input, close, resume.
- No broad database/schema redesign.

## Reference: Remodex

Remodex does not implement its own subagent runtime. It relies on Codex native subagents and adds presentation support:

- Parse Codex app-server collaboration/subagent items.
- Extract receiver thread IDs, agent identity, role, model, prompt, and status.
- Render subagent actions as timeline cards.
- Treat child thread output differently from the main thread output.

HAPI first-pass scope keeps the same core idea but stops short of persistent child-thread navigation.

## User experience

When Codex spawns subagents, the main HAPI timeline shows a card:

```text
Subagents
Spawning 2 agents

Explorer · running · gpt-5.4
Worker · pending · gpt-5.3-codex
```

The card is collapsed by default. Expanding it shows child output grouped by child thread / agent label:

```text
Explorer
  Thinking: scanning route handlers...
  Tool: rg "sessionCache"
  Assistant: The stale update rejection lives in ...

Worker
  Thinking: checking frontend state...
  Assistant: The rendering path is ...
```

The normal assistant stream remains reserved for the main Codex thread. The final synthesis from the main agent appears as a normal assistant message.

## Data model

### Subagent action event

Emitted when Codex reports orchestration activity such as spawning, waiting, updating, closing, or resuming agents.

```ts
type CodexSubagentActionEvent = {
    type: 'codex_subagent_action'
    tool: 'spawnAgent' | 'waitAgent' | 'sendInput' | 'closeAgent' | 'resumeAgent' | string
    status: 'in_progress' | 'completed' | 'failed' | string
    itemId?: string
    receiverThreadIds: string[]
    agents: Array<{
        threadId: string
        agentId?: string
        nickname?: string
        role?: string
        model?: string
        status?: string
        message?: string
        prompt?: string
    }>
}
```

### Subagent output event

Emitted for output that belongs to a child thread and must not become a normal main-thread assistant bubble.

```ts
type CodexSubagentOutputEvent = {
    type: 'codex_subagent_output'
    threadId: string
    agentId?: string
    role: 'assistant' | 'reasoning' | 'tool' | 'result' | 'status'
    text: string
    itemId?: string
    toolName?: string
    createdAt?: number
}
```

## Event routing rules

The CLI knows the active parent Codex thread ID (`currentThreadId`). For every app-server event that carries a `thread_id` / `threadId`:

1. If no thread ID is present, keep existing behavior. This avoids hiding legitimate main-thread output when Codex omits the field.
2. If the event thread ID equals the active parent thread ID, keep existing behavior.
3. If the event thread ID differs from the active parent thread ID, treat it as child/subagent output:
   - do not append to `messageBuffer` as main output;
   - do not call `session.sendAgentMessage({ type: 'message' })` as a normal assistant message;
   - emit `codex_subagent_output` instead.
4. Collaboration/subagent orchestration items emit `codex_subagent_action` regardless of whether child output is also present.

## CLI changes

### `cli/src/codex/utils/appServerEventConverter.ts`

Add helpers to detect and decode subagent collaboration items:

- Normalize item types by removing spaces, underscores, and dashes.
- Match known item/tool names:
  - `collabtoolcall`
  - `collabagenttoolcall`
  - `spawnagent`
  - `waitagent`
  - `sendinput`
  - `closeagent`
  - `resumeagent`
- Decode flexible field shapes seen in Codex/Remodex-style payloads:
  - `receiverThreadIds`, `receiver_thread_ids`, `threadIds`, `thread_ids`
  - `receiverThreadId`, `receiver_thread_id`, `threadId`, `thread_id`, `newThreadId`, `new_thread_id`
  - `receiverAgents`, `receiver_agents`, `agents`
  - `agentId`, `agent_id`, `newAgentId`, `new_agent_id`
  - `agentNickname`, `agent_nickname`, `nickname`, `name`
  - `agentRole`, `agent_role`, `agentType`, `agent_type`
  - `model`, `modelName`, `model_name`, `requestedModel`, `requested_model`
  - `statuses`, `agentStates`, `agent_states`, `agentsStates`, `agents_states`

For completed/started subagent items, return `codex_subagent_action` events.

Keep existing conversion for standard main-thread events.

### `cli/src/codex/codexRemoteLauncher.ts`

Add main-vs-child routing before handling display/message side effects.

For child events:

- `agent_message` -> `codex_subagent_output` role `assistant`
- `agent_reasoning` / `agent_reasoning_delta` -> role `reasoning`
- `exec_command_begin` -> role `tool`
- `exec_command_end` -> role `result`
- terminal events -> role `status`

Then return early for the normal main-message paths.

For `codex_subagent_action`, send it as an event-like agent message or session event compatible with web normalization. Prefer the existing event path if it already persists and streams through SSE the same way as compaction events; otherwise send an agent message with a dedicated type so it appears in history.

## Web changes

### Types / normalization

Update chat event types to include:

- `codex_subagent_action`
- `codex_subagent_output`

Normalize persisted records into event messages, not agent text blocks.

### Timeline projection

Add a subagent timeline block that can aggregate:

- the latest action event;
- related output events by `threadId`;
- agent labels from action metadata.

Aggregation rule for first pass:

- Attach output to the nearest preceding subagent action that references the same `threadId`.
- If no matching action exists, create a standalone generic subagent card for that `threadId`.

### UI

Add a simple `SubagentActionCard`:

- header: `Subagents`
- summary: `Spawning N agents`, `Waiting on N agents`, `Updating agent`, etc.
- rows: agent label, status, model if available
- collapsed by default
- expanded view: child output grouped by agent/thread

Keep styling consistent with current tool/status cards.

## Error handling and compatibility

- Unknown subagent tool names still render as `Agent activity`.
- Missing child thread ID means output stays in current path; do not guess.
- Duplicate deltas should continue to be deduped by item ID where existing converter buffers already do that.
- If Codex changes event field names, fallback to raw `item` metadata where safe, but do not block main output.

## Testing

### CLI converter tests

- Converts `collabToolCall` / `spawnAgent` item into `codex_subagent_action`.
- Decodes plural `receiverAgents` shape.
- Decodes singular top-level child thread identity shape.
- Preserves model/status fields.

### CLI remote launcher tests

- Main-thread `agent_message` still emits normal assistant message.
- Child-thread `agent_message` emits `codex_subagent_output`, not normal assistant message.
- Child reasoning/tool/result output is routed to subagent output.
- Events without thread ID keep old behavior.

### Web tests

- Normalizes subagent action/output events.
- Renders collapsed subagent card.
- Expanded card shows child output grouped by thread/agent.
- Child output does not appear as a standalone main assistant bubble.

## Rollout

1. Implement CLI conversion and routing first.
2. Add web normalization and minimal card renderer.
3. Add tests around converter/routing/rendering.
4. Run `bun typecheck` and targeted tests.

## Open questions

None for first pass. Future versions may add sidebar parent/child navigation and direct child-agent controls.
