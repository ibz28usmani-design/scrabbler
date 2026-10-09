import { openModal } from './nav';

let pending: { title: string; text: string } | null = null;

/** Opens the deck generator for arbitrary text (e.g. a source). */
export function openGenerateFromText(title: string, text: string, quiz = false) {
  pending = { title, text };
  openModal({ type: 'generateDeck', from: { kind: 'text' }, quiz });
}

export function takePendingText() {
  return pending;
}
