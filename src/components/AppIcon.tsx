import type { ComponentType, SVGProps } from 'react';
import * as I from './Icons';

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

/**
 * The app's icons by name, so folders, decks, menus and reminder types can
 * store which one they use. Pictures are drawn, never emoji: an emoji renders
 * differently on every device and fights the newsprint type.
 */
export const ICONS: Record<string, Icon> = {
  folder: I.IFolder,
  notes: I.IDoc,
  doc: I.IDoc,
  books: I.IBooks,
  book: I.IBook,
  flask: I.IFlask,
  brain: I.IBrain,
  briefcase: I.IBriefcase,
  grad: I.IGrad,
  dna: I.IDna,
  maths: I.ITriangle,
  ruler: I.IRuler,
  globe: I.IGlobe,
  bulb: I.IBulb,
  palette: I.IPalette,
  health: I.IStethoscope,
  scales: I.IScales,
  laptop: I.ILaptop,
  music: I.IMusic,
  plane: I.IPlane,
  home: I.IHome,
  heart: I.IHeart,
  chart: I.IChart,
  archive: I.IArchive,
  inbox: I.IInbox,
  cards: I.ICards,
  question: I.IQuestion,
  bandage: I.IBandage,
  mic: I.IMic,
  pencil: I.IPencil,
  link: I.ILink,
  image: I.IImage,
  file: I.IFile,
  paperclip: I.IPaperclip,
  bookmark: I.IBookmark,
  calendar: I.ICalendar,
  clock: I.IClock,
  smile: I.ISmile,
  sparkle: I.ISparkle,
  trash: I.ITrash,
  copy: I.ICopy,
  swap: I.ISwap,
  quote: I.IQuote,
  checklist: I.IChecklist,
  check: I.ICheck,
  play: I.IPlay,
  table: I.ITable,
  flag: I.IFlag,
  repeat: I.IRepeat,
  tag: I.ITag,
  presentation: I.IPresentation,
  clipboard: I.IClipboard,
  user: I.IUser,
  timer: I.ITimer,
  trophy: I.ITrophy,
  leaf: I.ILeaf,
};

/** Emoji stored by earlier versions (folders, decks), and the icon each became. */
const FROM_EMOJI: Record<string, string> = {
  '🗒️': 'notes', '🗒': 'notes', '📚': 'books', '🧪': 'flask', '🧠': 'brain', '💼': 'briefcase', '🎓': 'grad', '🧬': 'dna',
  '📐': 'maths', '🌍': 'globe', '💡': 'bulb', '🎨': 'palette', '🩺': 'health', '⚖️': 'scales', '⚖': 'scales', '💻': 'laptop',
  '🎵': 'music', '✈️': 'plane', '✈': 'plane', '🏠': 'home', '❤️': 'heart', '❤': 'heart', '📈': 'chart', '🗃️': 'archive', '🗃': 'archive',
  '📁': 'folder', '🗂️': 'cards', '🗂': 'cards', '🃏': 'cards', '❓': 'question', '📥': 'inbox', '🩹': 'bandage', '📓': 'book', '📄': 'doc',
};

/** The icon a stored value names: an icon name, or an emoji from before icons. */
export function iconName(stored: string | undefined, fallback = 'folder'): string {
  if (stored && ICONS[stored]) return stored;
  return (stored && FROM_EMOJI[stored]) || fallback;
}

export function AppIcon({ name, fallback, size = 18, className }: { name: string | undefined; fallback?: string; size?: number; className?: string }) {
  const Glyph = ICONS[iconName(name, fallback)] ?? I.IFolder;
  return <Glyph size={size} className={className} />;
}

/** Icons offered for folders, in the picker's order. */
export const FOLDER_ICONS = ['folder', 'notes', 'books', 'scales', 'chart', 'maths', 'flask', 'brain', 'dna', 'globe', 'health', 'laptop', 'briefcase', 'grad', 'bulb', 'palette', 'music', 'presentation', 'plane', 'home', 'heart', 'archive'];

/** A menu glyph: an icon when it names one, otherwise a typographic label ("H1", "•", "</>"). */
export function Glyph({ icon, size = 17 }: { icon: string; size?: number }) {
  const G = ICONS[icon];
  return G ? <G size={size} /> : <>{icon}</>;
}
