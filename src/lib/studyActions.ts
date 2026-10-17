import { openModal } from './nav';

/** Opens the deck generator for arbitrary text (e.g. a source). */
export function openGenerateFromText(title: string, text: string, quiz = false) {
  // The text travels with the dialog, so a later "Generate with AI…" starts empty.
  openModal({ type: 'generateDeck', from: { kind: 'text', title, text }, quiz });
}
