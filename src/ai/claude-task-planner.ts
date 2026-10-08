import Anthropic from '@anthropic-ai/sdk';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TaskPriority } from '../tasks/schemas/task.schema';
import { PlanContext, SuggestedTask, TaskPlanner } from './task-planner';

const MODEL = 'claude-opus-5-5';
const MAX_TASKS = 20;
const MAX_SUBTASKS = 8;

const SYSTEM_PROMPT = `You are a senior project planner inside Taskify, a task management app.
Break the user's goal into concrete, actionable top-level tasks in a sensible delivery order, each with a few short subtasks.
Titles are imperative and under 80 characters. Descriptions are one or two sentences explaining the outcome.
Use URGENT sparingly; most work is HIGH or MEDIUM. Do not repeat tasks the project already has.
Return at most ${MAX_TASKS} tasks with at most ${MAX_SUBTASKS} subtasks each.`;

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: Object.values(TaskPriority) },
          subtasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: { title: { type: 'string' } },
              required: ['title'],
              additionalProperties: false,
            },
          },
        },
        required: ['title', 'description', 'priority', 'subtasks'],
        additionalProperties: false,
      },
    },
  },
  required: ['tasks'],
  additionalProperties: false,
};

const clip = (value: string, max: number) => value.trim().slice(0, max);

@Injectable()
export class ClaudeTaskPlanner extends TaskPlanner {
  private readonly logger = new Logger(ClaudeTaskPlanner.name);
  private readonly client?: Anthropic;

  constructor() {
    super();
    // Credentials resolve from the environment (ANTHROPIC_API_KEY, etc.).
    if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
      this.client = new Anthropic();
    }
  }

  async breakDown(context: PlanContext): Promise<SuggestedTask[]> {
    if (!this.client) {
      throw new ServiceUnavailableException('AI features are not configured');
    }

    const existing = context.existingTaskTitles.length
      ? `\nExisting tasks:\n${context.existingTaskTitles
          .map((t) => `- ${t}`)
          .join('\n')}`
      : '';

    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        // Re-routes to a fallback model if the request is declined by a safety classifier.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: PLAN_SCHEMA },
        },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Project: ${context.projectName}${existing}\n\nGoal: ${context.goal}`,
          },
        ],
      });
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) {
        throw new ServiceUnavailableException(
          'AI is busy, please retry shortly',
        );
      }
      if (error instanceof Anthropic.APIError) {
        this.logger.error(`Claude API error ${error.status}: ${error.message}`);
        throw new ServiceUnavailableException('AI request failed');
      }
      throw error;
    }

    if (response.stop_reason === 'refusal') {
      throw new UnprocessableEntityException(
        'The AI declined to plan this goal',
      );
    }
    const text = response.content.find(
      (block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text',
    )?.text;
    if (!text || response.stop_reason === 'max_tokens') {
      throw new ServiceUnavailableException('AI returned an incomplete plan');
    }

    const { tasks } = JSON.parse(text) as { tasks: SuggestedTask[] };
    // Schema guarantees the shape; still enforce our own size limits.
    return tasks.slice(0, MAX_TASKS).map((task) => ({
      title: clip(task.title, 200),
      description: clip(task.description, 2000),
      priority: task.priority,
      subtasks: task.subtasks
        .slice(0, MAX_SUBTASKS)
        .map((s) => ({ title: clip(s.title, 200) })),
    }));
  }
}
