import type { EvaluationCase } from "./dataset.js";

export interface EvaluationSession {
  message(conversationId: string, input: string): Promise<string>;
  reset(conversationId: string): Promise<void> | void;
}

export interface CaseExecution {
  outputs: string[];
  messageConversationIds: string[];
}

export async function executeEvaluationCase(testCase: EvaluationCase, session: EvaluationSession): Promise<CaseExecution> {
  let conversationId = "primary";
  const outputs: string[] = [];
  const messageConversationIds: string[] = [];
  for (const step of testCase.steps) {
    if (step.action === "switch_conversation") {
      conversationId = step.conversationId;
    } else if (step.action === "reset") {
      await session.reset(conversationId);
    } else {
      outputs.push(await session.message(conversationId, step.input));
      messageConversationIds.push(conversationId);
    }
  }
  return { outputs, messageConversationIds };
}
