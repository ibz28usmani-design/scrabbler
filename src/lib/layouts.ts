/** Page layouts (note-taking methods), paper styles and document templates. */
export type Region = { id: string; label: string; min?: number; hint?: string };
export type Layout = { name: string; subject: string; about: string; areas: string; cols: string; regions: Region[] };

export const LAYOUTS: Record<string, Layout> = {
  free: { name: 'Blank page', subject: 'General', about: 'One open page.', areas: '"body"', cols: '1fr', regions: [{ id: 'body', label: '', min: 900 }] },
  cornell: {
    name: 'Cornell', subject: 'General', about: 'Cues on the left, notes on the right, summary underneath.',
    areas: '"cues notes" "summary summary"', cols: '30% 1fr',
    regions: [{ id: 'cues', label: 'Cues & questions', min: 720, hint: 'Key terms, questions' }, { id: 'notes', label: 'Notes', min: 720 }, { id: 'summary', label: 'Summary', min: 170, hint: 'Sum the page up in two or three sentences' }],
  },
  inclass: {
    name: 'In-class', subject: 'General', about: 'A margin for distractions and to-dos, flags on the right.',
    areas: '"side main flags"', cols: '20% 1fr 14%',
    regions: [{ id: 'side', label: 'Distractions · To do', min: 900 }, { id: 'main', label: 'Notes', min: 900, hint: '– main point, ○ sub-note' }, { id: 'flags', label: '✱ Flags', min: 900, hint: '✱ hw, ✱ due' }],
  },
  maths: {
    name: 'Maths concept', subject: 'Mathematics', about: 'Concept, explanations beside formulas, then a worked example.',
    areas: '"concept concept" "explain formulas" "example example"', cols: '1fr 1fr',
    regions: [{ id: 'concept', label: 'Concept', min: 150 }, { id: 'explain', label: 'Explanations', min: 250 }, { id: 'formulas', label: 'Formulas', min: 250 }, { id: 'example', label: 'Example question', min: 450 }],
  },
  mathsproblem: {
    name: 'Maths worked problem', subject: 'Mathematics', about: 'Question, method, working and a checked answer.',
    areas: '"q q" "work method" "work check" "answer answer"', cols: '1fr 32%',
    regions: [{ id: 'q', label: 'Question', min: 110 }, { id: 'work', label: 'Working', min: 560 }, { id: 'method', label: 'Method & formulas', min: 280 }, { id: 'check', label: 'Check · common errors', min: 280 }, { id: 'answer', label: 'Answer', min: 90 }],
  },
  lawcase: {
    name: 'Law case brief', subject: 'Law', about: 'Facts, issue, decision, ratio, obiter and why the case matters.',
    areas: '"cite cite" "facts issue" "held ratio" "obiter sig"', cols: '1fr 1fr',
    regions: [{ id: 'cite', label: 'Case · citation · court', min: 80 }, { id: 'facts', label: 'Material facts', min: 220 }, { id: 'issue', label: 'Legal issue', min: 220 }, { id: 'held', label: 'Held (decision)', min: 220 }, { id: 'ratio', label: 'Ratio decidendi', min: 220 }, { id: 'obiter', label: 'Obiter dicta', min: 170 }, { id: 'sig', label: 'Significance · later cases', min: 170 }],
  },
  lawirac: {
    name: 'Law problem (IRAC)', subject: 'Law', about: 'Issue, Rule, Application, Conclusion for scenario questions.',
    areas: '"issue" "rule" "apply" "concl"', cols: '1fr',
    regions: [{ id: 'issue', label: 'Issue', min: 130 }, { id: 'rule', label: 'Rule · statute and cases', min: 240 }, { id: 'apply', label: 'Application to the facts', min: 340 }, { id: 'concl', label: 'Conclusion', min: 130 }],
  },
  econ: {
    name: 'Economics analysis', subject: 'Economics', about: 'Diagram, definitions, a chain of analysis and evaluation.',
    areas: '"diagram defs" "chain chain" "eval eval"', cols: '1fr 1fr',
    regions: [{ id: 'diagram', label: 'Diagram (draw here)', min: 300 }, { id: 'defs', label: 'Definitions · data', min: 300 }, { id: 'chain', label: 'Chain of analysis: point → because → therefore', min: 300 }, { id: 'eval', label: 'Evaluation: depends on · short vs long run · magnitude', min: 220 }],
  },
  econessay: {
    name: 'Economics essay plan', subject: 'Economics', about: 'A 25-mark plan: two arguments with evaluation and a judgement.',
    areas: '"q q" "a1 e1" "a2 e2" "j j"', cols: '1fr 1fr',
    regions: [{ id: 'q', label: 'Question · key terms', min: 110 }, { id: 'a1', label: 'Argument 1 (KAA)', min: 250 }, { id: 'e1', label: 'Evaluation 1', min: 250 }, { id: 'a2', label: 'Argument 2 (KAA)', min: 250 }, { id: 'e2', label: 'Evaluation 2', min: 250 }, { id: 'j', label: 'Judgement', min: 140 }],
  },
};

export const PAPERS: Record<string, string> = { plain: 'Plain', ruled: 'Ruled', grid: 'Square grid', graph: 'Graph paper', dot: 'Dotted' };

export type DocTemplate = { name: string; about: string; title: string; html: string };
const today = () => new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
export const DOC_TEMPLATES: DocTemplate[] = [
  { name: 'Essay', about: 'Title, introduction, three points, conclusion', title: 'Essay title', html: `<h1>Essay title</h1><p><em>Your name · ${today()}</em></p><h2>Introduction</h2><p>Set out the question, define the key terms and state your line of argument.</p><h2>Point one</h2><p>Point. Evidence. Explanation. Link back to the question.</p><h2>Point two</h2><p></p><h2>Counter-argument</h2><p></p><h2>Conclusion</h2><p>Answer the question directly and justify your judgement.</p>` },
  { name: 'Report', about: 'Summary, findings, recommendations', title: 'Report', html: `<h1>Report title</h1><p><em>Prepared by … · ${today()}</em></p><h2>Summary</h2><p>The main finding in three sentences.</p><h2>Background</h2><p></p><h2>Findings</h2><ol><li><p>First finding</p></li><li><p>Second finding</p></li></ol><h2>Recommendations</h2><ul><li><p></p></li></ul><h2>Sources</h2><p></p>` },
  { name: 'Letter', about: 'Formal letter layout', title: 'Letter', html: `<p style="text-align:right">Your address<br>Town, Postcode<br>${today()}</p><p>Recipient name<br>Organisation<br>Address</p><p>Dear …,</p><p><strong>Re: subject of the letter</strong></p><p>Opening paragraph: why you are writing.</p><p>Middle paragraph: the detail.</p><p>Closing paragraph: what you would like to happen next.</p><p>Yours sincerely,</p><p>Your name</p>` },
  { name: 'CV', about: 'Profile, education, experience, skills', title: 'CV', html: `<h1 style="text-align:center">Your Name</h1><p style="text-align:center">email · phone · town</p><h2>Profile</h2><p>Two lines on who you are and what you are looking for.</p><h2>Education</h2><p><strong>College</strong> · 2026–2028<br>A-levels: Law, Economics, Mathematics</p><h2>Experience</h2><p><strong>Role</strong> · Organisation · dates</p><ul><li><p>What you did and what it achieved</p></li></ul><h2>Skills & interests</h2><ul><li><p></p></li></ul>` },
  { name: 'Meeting notes', about: 'Attendees, agenda, actions', title: 'Meeting notes', html: `<h1>Meeting notes</h1><p><strong>Date:</strong> ${today()} · <strong>Attendees:</strong> …</p><h2>Agenda</h2><ol><li><p></p></li></ol><h2>Notes</h2><p></p><h2>Actions</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Action · owner · due</p></li></ul>` },
  { name: 'Project proposal', about: 'Problem, plan, timeline', title: 'Project proposal', html: `<h1>Project proposal</h1><h2>The problem</h2><p></p><h2>What I propose</h2><p></p><h2>Plan</h2><table><tbody><tr><th><p>Stage</p></th><th><p>What happens</p></th><th><p>By when</p></th></tr><tr><td><p>1</p></td><td><p></p></td><td><p></p></td></tr><tr><td><p>2</p></td><td><p></p></td><td><p></p></td></tr></tbody></table><h2>Risks</h2><ul><li><p></p></li></ul>` },
  { name: 'Law essay', about: 'A-level evaluation essay structure', title: 'Law essay', html: `<h1>Question</h1><p><em>Copy the question here and underline the command word.</em></p><h2>Introduction</h2><p>Define the area of law and signpost your argument.</p><h2>Point 1: the current law</h2><p>State the rule with its authority (case or section). Explain. Evaluate: is it fair, certain, consistent?</p><h2>Point 2</h2><p></p><h2>Point 3: reform</h2><p>Law Commission proposals or academic criticism.</p><h2>Conclusion</h2><p>A reasoned judgement that answers the question.</p>` },
  { name: 'Revision sheet', about: 'One-page topic summary with key cases or formulas', title: 'Revision sheet', html: `<h1>Topic</h1><h2>Key definitions</h2><ul><li><p><strong>Term</strong>: meaning</p></li></ul><h2>Must-know points</h2><ol><li><p></p></li></ol><h2>Cases · formulas · diagrams</h2><table><tbody><tr><th><p>Name</p></th><th><p>What it shows</p></th></tr><tr><td><p></p></td><td><p></p></td></tr></tbody></table><h2>Exam traps</h2><ul><li><p></p></li></ul>` },
];
