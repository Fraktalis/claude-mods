export type TaskStatus = 'pending' | 'in_progress' | 'completed'
export type Task = { subject: string; status: TaskStatus }

/** What a loop reported through the progress tool. */
export type Report = { done: number; total: number; step?: string }

export type AgentStatus = 'waiting' | 'running' | 'done' | 'failed'

export type AgentRow = {
  id: string
  description: string
  type: string
  model: string
  effort?: string
  status: AgentStatus
  steps: number
  tools: number
  /** Dollars at the model's list price, summed over the agent's requests. */
  usd: number
  tokens: number
  /** Prompt size of the last step, for the ctx % figure. */
  ctx: number
  startedAt: number
  endedAt?: number
  report?: Report
}

export type Batch = { id: number; title: string; startedAt: number; endedAt?: number; ids: string[]; hidden: boolean }

declare module 'claude-code' {
  interface PluginState {
    'savvy-progress': {
      /** Task lists by owner loop: 'main' or a subagent id, then by task id. */
      tasks: Record<string, Record<string, Task>>
      agents: Record<string, AgentRow>
      /** Skin name by agent type ('*' is the fallback). */
      skins: Record<string, string>
      batch: Batch | null
      mainReport: Report | null
      finishedCollapsed: boolean
      /** The main loop's last prompt, the batch title when nothing names one. */
      lastPrompt: string
    }
  }
}
