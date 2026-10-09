/** Paper styles for ink drawing blocks, shared by the canvas, the drawing node and note creation. */
export type Paper = 'blank' | 'lines' | 'grid' | 'dots' | 'cornell';

/** Cornell layout guides, in the canvas's logical 1000-wide coordinate space. */
const CORNELL_CUE_X = 260;
const CORNELL_SUMMARY_H = 170;
export const CORNELL_DEFAULT_HEIGHT = 1500;

export function cornellGuides(height: number) {
  return { cueX: CORNELL_CUE_X, summaryY: Math.max(240, height - CORNELL_SUMMARY_H) };
}

export interface HandwritingTemplate {
  paper: Paper;
  label: string;
  description: string;
  height: number;
}

/** Templates offered when starting a new handwritten note. */
export const HANDWRITING_TEMPLATES: HandwritingTemplate[] = [
  { paper: 'blank', label: 'Plain', description: 'Freeform page', height: 900 },
  { paper: 'lines', label: 'Lined', description: 'Ruled paper', height: 1200 },
  { paper: 'grid', label: 'Square grid', description: 'Graph paper', height: 900 },
  { paper: 'cornell', label: 'Cornell', description: 'Cues, notes & summary', height: CORNELL_DEFAULT_HEIGHT },
];
