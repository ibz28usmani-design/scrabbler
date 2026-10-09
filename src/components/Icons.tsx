import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const make = (d: string | string[], fill = false) =>
  function Icon({ size = 20, ...rest }: P) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={fill ? 'currentColor' : 'none'}
        stroke={fill ? 'none' : 'currentColor'}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {(Array.isArray(d) ? d : [d]).map((p, i) => (
          <path key={i} d={p} />
        ))}
      </svg>
    );
  };

export const IFolder = make('M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2 2.2h7.4A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z');
export const ICompose = make(['M12 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V12', 'M18.4 3.6a2 2 0 0 1 2.9 2.9L13 14.8l-3.6.8.8-3.6z']);
export const ISearch = make(['M10.8 18a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4z', 'M16 16l5 5']);
export const ITrash = make(['M4 7h16', 'M9.5 7V4.8h5V7', 'M6.5 7l.9 12.1A1.5 1.5 0 0 0 8.9 20.5h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7', 'M10 11v5.5M14 11v5.5']);
export const IPin = make(['M14.5 3.5l6 6', 'M16.5 5.5L12 10l-4.5-.5L5 12l7 7 2.5-2.5L14 12l4.5-4.5', 'M8.5 15.5L4 20']);
export const IGear = make([
  'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z',
  'M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4z',
]);
export const ISparkle = make(['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z', 'M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z']);
export const IMic = make(['M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 0 0-7 0v5A3.5 3.5 0 0 0 12 15z', 'M5.5 11.5a6.5 6.5 0 0 0 13 0', 'M12 18v3']);
export const IPencil = make(['M15.2 4.8l4 4L8.6 19.4 3.5 20.5l1.1-5.1z', 'M13.2 6.8l4 4']);
export const IChecklist = make(['M4 6.5l1.5 1.5L8.5 5', 'M4 12.5l1.5 1.5 3-3', 'M4 18.5l1.5 1.5 3-3', 'M11.5 6.5H20M11.5 12.5H20M11.5 18.5H20']);
export const ITable = make(['M4 5.5h16v13H4z', 'M4 10h16M4 14.5h16M10 5.5v13']);
export const IImage = make(['M4 5.5h16v13H4z', 'M8.5 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M20 15l-4.5-4.5L7 18.5']);
export const IAa = make(['M3 18l4.5-12L12 18', 'M4.6 14h5.8', 'M15 13.2a2.8 2.8 0 1 1 0 5.2 2.8 2.8 0 0 1 0-5.2zM20 11v7.5']);
export const IChevL = make('M15 5l-7 7 7 7');
export const IChevR = make('M9 5l7 7-7 7');
export const IChevD = make('M5 9l7 7 7-7');
export const IPlus = make('M12 5v14M5 12h14');
export const IMore = make(['M6 12h.01M12 12h.01M18 12h.01']);
export const IBook = make(['M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z', 'M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z']);
export const ICards = make(['M7 4.5h11a1.5 1.5 0 0 1 1.5 1.5v10', 'M4.5 8.5A1.5 1.5 0 0 1 6 7h9.5A1.5 1.5 0 0 1 17 8.5v10a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5z']);
export const IFlame = make('M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.4-5.4 3.6-8 .7 1.4 1.6 2.4 2.7 2.9.2-2.4 1.1-4.6 3-6.2.3 3.1 3.7 5.3 3.7 9.8 0 4.4-2.8 7.7-6.5 7.7z', true);
export const IHeart = make('M12 20.5S3.5 15.3 3.5 9.2A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.5 2.8c0 6.1-8.5 11.3-8.5 11.3z', true);
export const IBolt = make('M13 2.5L5 13.5h6l-1 8 8-11h-6z', true);
export const IPlay = make('M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.5-7.2a.8.8 0 0 0 0-1.4L8.2 4.1a.8.8 0 0 0-1.2.7z', true);
export const IPause = make(['M7 4.5h3.2v15H7zM13.8 4.5H17v15h-3.2z'], true);
export const IStop = make('M6 6h12v12H6z', true);
export const IUpload = make(['M12 15V4', 'M7.5 8.5L12 4l4.5 4.5', 'M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15']);
export const ILink = make(['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1']);
export const IYouTube = make(['M3 8.4c.1-1.6 1.3-2.9 2.9-3 1.9-.2 3.9-.3 6.1-.3s4.2.1 6.1.3c1.6.1 2.8 1.4 2.9 3 .1 1.2.2 2.4.2 3.6s-.1 2.4-.2 3.6c-.1 1.6-1.3 2.9-2.9 3-1.9.2-3.9.3-6.1.3s-4.2-.1-6.1-.3c-1.6-.1-2.8-1.4-2.9-3C2.9 14.4 2.8 13.2 2.8 12s.1-2.4.2-3.6z', 'M10 9.2v5.6l4.8-2.8z']);
export const IFile = make(['M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z', 'M14 3.5V8h4.5', 'M9 13h6M9 16.5h6']);
export const IText = make(['M5 6h14', 'M5 10.5h14', 'M5 15h9', 'M5 19.5h6']);
export const IX = make('M6 6l12 12M18 6L6 18');
export const ISend = make(['M12 19V5', 'M6 11l6-6 6 6']);
export const ICheck = make('M5 12.5l4.5 4.5L19 7.5');
export const IUndo = make(['M9 14L4.5 9.5 9 5', 'M4.5 9.5H15a5 5 0 0 1 0 10h-3']);
export const IRedo = make(['M15 14l4.5-4.5L15 5', 'M19.5 9.5H9a5 5 0 0 0 0 10h3']);
export const IEraser = make(['M8.5 20.5h11', 'M3.9 14.1l9.2-9.2a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L11 19H7.4z', 'M8.5 9.5l6 6']);
export const ISidebar = make(['M3.5 5.5h17v13h-17z', 'M9 5.5v13']);
export const IDownload = make(['M12 4v11', 'M7.5 10.5L12 15l4.5-4.5', 'M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15']);
export const ICopy = make(['M8.5 8.5h10v11h-10z', 'M15.5 8.5v-3h-10v11h3']);
export const IHeadphones = make(['M4 15v-3a8 8 0 0 1 16 0v3', 'M4 14.5h3v6H5.5A1.5 1.5 0 0 1 4 19zM20 14.5h-3v6h1.5a1.5 1.5 0 0 0 1.5-1.5z']);
export const IMind = make(['M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', 'M5 5.5a1.5 1.5 0 1 0 0 .1M19 5.5a1.5 1.5 0 1 0 0 .1M5 18.5a1.5 1.5 0 1 0 0 .1M19 18.5a1.5 1.5 0 1 0 0 .1', 'M6.2 6.6l3.9 3.9M17.8 6.6l-3.9 3.9M6.2 17.4l3.9-3.9M17.8 17.4l-3.9-3.9']);
export const IClock = make(['M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z', 'M12 7.5V12l3 2']);
export const IQuestion = make(['M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z', 'M9.6 9.4a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2.1-2.4 3.6', 'M12 17h.01']);
export const IDoc = make(['M6.5 3.5h11v17h-11z', 'M9.5 8h5M9.5 11.5h5M9.5 15h3']);
export const IGrad = make(['M2.5 9.5L12 5l9.5 4.5L12 14z', 'M6.5 11.5v4.2c1.4 1.3 3.3 2 5.5 2s4.1-.7 5.5-2v-4.2', 'M21.5 9.5v5']);
export const IHighlighter = make(['M9 15.5l-2 5h5l1-2.5', 'M9 15.5L16.5 4l4 2.5L13 18z']);
export const IMarker = make(['M14.5 4.5l5 5-9 9H5.5v-5z', 'M12.5 6.5l5 5']);
export const IRuler = make(['M3.5 15.5L15.5 3.5l5 5-12 12z', 'M7 12l2 2M10 9l2 2M13 6l2 2']);
export const IShare = make(['M12 3.5v11', 'M8 7.5l4-4 4 4', 'M6.5 11H5.5A1.5 1.5 0 0 0 4 12.5v6A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5h-1']);
export const IRefresh = make(['M19.5 12a7.5 7.5 0 1 1-2.2-5.3', 'M19.5 4.5v4h-4']);
export const ILasso = make(['M12 14.5c4.7 0 8.5-2.2 8.5-5S16.7 4.5 12 4.5 3.5 6.7 3.5 9.5c0 1.7 1.4 3.2 3.6 4.1', 'M7.1 13.6c-1 .5-1.6 1.3-1.6 2.2 0 1.5 1.8 2.7 4 2.7 1 0 1.5.8 1 2']);
export const ITextT = make(['M5 6V4.5h14V6', 'M12 4.5v15', 'M9 19.5h6']);
export const IList = make(['M8.5 6.5H20M8.5 12H20M8.5 17.5H20', 'M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01']);
export const IExpand = make(['M4.5 9V4.5H9', 'M15 4.5h4.5V9', 'M19.5 15v4.5H15', 'M9 19.5H4.5V15']);
export const IShrink = make(['M9 4.5V9H4.5', 'M15 4.5V9h4.5', 'M19.5 15H15v4.5', 'M9 19.5V15H4.5']);
export const ISun = make(['M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z', 'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4']);
export const IMoon = make('M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z');
export const IRuled = make(['M4 6.5h16', 'M4 11h16', 'M4 15.5h16', 'M4 20h16', 'M7.5 3.5v17']);
export const IPrint = make(['M7 9V3.5h10V9', 'M7 17.5H5a1.5 1.5 0 0 1-1.5-1.5v-5.5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 1-1.5 1.5h-2', 'M7 14h10v6.5H7z']);
export const IHandwriting = make(['M3.5 17c2-3 3.5-7 5.5-7 1.7 0 .3 6 2 6 1.4 0 2.2-3.5 3.6-3.5 1.1 0 1 2.5 2.4 2.5 1 0 1.7-1 2.5-2', 'M3.5 20.5h17']);
export const ITyped = make(['M5 5.5h14', 'M12 5.5v13', 'M9 18.5h6']);
