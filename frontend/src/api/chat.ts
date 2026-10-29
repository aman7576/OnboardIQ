import { apiFetch } from './http';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Sends the conversation so far (the last 12 turns at most) and returns the assistant's answer. */
export const askAssistant = (messages: ChatMessage[]) =>
  apiFetch<{ reply: string }>('/api/v1/chat', {
    method: 'POST',
    body: { messages: messages.slice(-12) },
  });
