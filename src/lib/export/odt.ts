/** OpenDocument Text (.odt) — LibreOffice, Pages and Google Docs all open it. */
import JSZip from 'jszip';
import { type Block, dataUrlBytes, imageSize, type Run } from './ir';

const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface OdtImages {
  sketch?: (b: Extract<Block, { type: 'drawing' }>) => Uint8Array | null;
}

/** Text with spaces, tabs and line breaks in ODF's element form. */
function odfText(s: string): string {
  return x(s)
    .replace(/\t/g, '<text:tab/>')
    .replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`);
}

class Writer {
  pics: { path: string; bytes: Uint8Array; mime: string }[] = [];
  autoStyles = new Map<string, string>();

  spanStyle(r: Run): string | null {
    const props: string[] = [];
    if (r.b) props.push('fo:font-weight="bold" style:font-weight-asian="bold"');
    if (r.i) props.push('fo:font-style="italic" style:font-style-asian="italic"');
    if (r.u) props.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"');
    if (r.s) props.push('style:text-line-through-style="solid"');
    if (r.code) props.push('style:font-name="Courier New" fo:background-color="#f3f1ec"');
    if (r.mark) props.push(`fo:background-color="${r.mark.startsWith('#') ? r.mark.slice(0, 7) : '#fde68a'}"`);
    if (!props.length) return null;
    const key = props.join(' ');
    let name = this.autoStyles.get(key);
    if (!name) {
      name = `T${this.autoStyles.size + 1}`;
      this.autoStyles.set(key, name);
    }
    return name;
  }

  runs(rs: Run[]): string {
    return rs
      .map((r) => {
        if (r.br) return '<text:line-break/>';
        const style = this.spanStyle(r);
        let t = odfText(r.text);
        if (style) t = `<text:span text:style-name="${style}">${t}</text:span>`;
        if (r.href) t = `<text:a xlink:type="simple" xlink:href="${x(r.href)}">${t}</text:a>`;
        return t;
      })
      .join('');
  }

  picture(bytes: Uint8Array, mime: string): string {
    const size = imageSize(bytes);
    if (!size) return '';
    const n = this.pics.length + 1;
    const path = `Pictures/image${n}.${size.kind === 'png' ? 'png' : 'jpg'}`;
    this.pics.push({ path, bytes, mime });
    const wCm = Math.min(16, size.width / 37.8);
    const hCm = (wCm * size.height) / size.width;
    return `<text:p text:style-name="Figure"><draw:frame draw:name="Image${n}" text:anchor-type="as-char" svg:width="${wCm.toFixed(2)}cm" svg:height="${hCm.toFixed(2)}cm"><draw:image xlink:href="${path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></text:p>`;
  }

  blocks(blocks: Block[], images: OdtImages, quote = false): string {
    const P = quote ? 'Quote' : 'Body';
    return blocks
      .map((b) => {
        switch (b.type) {
          case 'heading':
            return `<text:h text:style-name="Heading_20_${b.level}" text:outline-level="${b.level}">${this.runs(b.runs)}</text:h>`;
          case 'paragraph': {
            const style = b.align && b.align !== 'left' ? `${P}_${b.align}` : P;
            return `<text:p text:style-name="${style}">${this.runs(b.runs)}</text:p>`;
          }
          case 'list': {
            const style = b.style === 'ordered' ? 'LNumber' : b.style === 'task' ? 'LTask' : 'LBullet';
            const items = b.items
              .map((it) => {
                const box = b.style === 'task' ? (it.checked ? '☑ ' : '☐ ') : '';
                return `<text:list-item><text:p text:style-name="${P}">${box}${this.runs(it.runs)}</text:p>${this.blocks(it.children, images, quote)}</text:list-item>`;
              })
              .join('');
            const start = b.style === 'ordered' && (b.start ?? 1) !== 1 ? ` text:continue-numbering="false"` : '';
            return `<text:list text:style-name="${style}"${start}>${items}</text:list>`;
          }
          case 'quote':
            return this.blocks(b.blocks, images, true);
          case 'code':
            return b.text
              .split('\n')
              .map((l) => `<text:p text:style-name="Code">${odfText(l)}</text:p>`)
              .join('');
          case 'hr':
            return '<text:p text:style-name="Rule"/>';
          case 'table': {
            const cols = Math.max(1, ...b.rows.map((r) => r.cells.length));
            const rows = b.rows
              .map(
                (r) =>
                  `<table:table-row>${Array.from({ length: cols }, (_, i) => `<table:table-cell table:style-name="${r.header ? 'CellHead' : 'Cell'}" office:value-type="string"><text:p text:style-name="${r.header ? 'TableHead' : 'TableBody'}">${this.runs(r.cells[i] ?? [])}</text:p></table:table-cell>`).join('')}</table:table-row>`,
              )
              .join('');
            return `<table:table table:style-name="Tbl"><table:table-column table:number-columns-repeated="${cols}"/>${rows}</table:table>`;
          }
          case 'image': {
            const img = dataUrlBytes(b.src);
            return img ? this.picture(img.bytes, img.mime) : '';
          }
          case 'drawing': {
            const png = images.sketch?.(b);
            return png ? this.picture(png, 'image/png') : `<text:p text:style-name="${P}">[sketch]</text:p>`;
          }
        }
      })
      .join('');
  }
}

const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0" office:version="1.3"';

const FONTS =
  '<office:font-face-decls><style:font-face style:name="Times New Roman" svg:font-family="&apos;Times New Roman&apos;" style:font-family-generic="roman"/><style:font-face style:name="Courier New" svg:font-family="&apos;Courier New&apos;" style:font-family-generic="modern"/></office:font-face-decls>';

const STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${NS}>${FONTS}
<office:styles>
<style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.22cm" fo:line-height="125%"/><style:text-properties style:font-name="Times New Roman" fo:font-size="11.5pt" fo:color="#1a1a1a" fo:language="en" fo:country="GB"/></style:default-style>
<style:style style:name="Standard" style:family="paragraph" style:class="text"/>
<style:style style:name="Body" style:family="paragraph" style:parent-style-name="Standard"/>
<style:style style:name="Body_center" style:family="paragraph" style:parent-style-name="Body"><style:paragraph-properties fo:text-align="center"/></style:style>
<style:style style:name="Body_right" style:family="paragraph" style:parent-style-name="Body"><style:paragraph-properties fo:text-align="end"/></style:style>
<style:style style:name="Body_justify" style:family="paragraph" style:parent-style-name="Body"><style:paragraph-properties fo:text-align="justify"/></style:style>
<style:style style:name="Quote" style:family="paragraph" style:parent-style-name="Body"><style:paragraph-properties fo:margin-left="0.8cm" fo:padding-left="0.3cm" fo:border-left="1.5pt solid #1a1a1a"/><style:text-properties fo:font-style="italic"/></style:style>
<style:style style:name="Quote_center" style:family="paragraph" style:parent-style-name="Quote"><style:paragraph-properties fo:text-align="center"/></style:style>
<style:style style:name="Quote_right" style:family="paragraph" style:parent-style-name="Quote"><style:paragraph-properties fo:text-align="end"/></style:style>
<style:style style:name="Quote_justify" style:family="paragraph" style:parent-style-name="Quote"><style:paragraph-properties fo:text-align="justify"/></style:style>
<style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard" style:class="text"><style:paragraph-properties fo:keep-with-next="always"/><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="1"><style:paragraph-properties fo:margin-top="0.2cm" fo:margin-bottom="0.4cm" fo:padding-bottom="0.1cm" fo:border-bottom="2.2pt solid #1a1a1a"/><style:text-properties fo:font-size="23pt"/></style:style>
<style:style style:name="Heading_20_2" style:display-name="Heading 2" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="2"><style:paragraph-properties fo:margin-top="0.5cm" fo:margin-bottom="0.2cm"/><style:text-properties fo:font-size="16.5pt"/></style:style>
<style:style style:name="Heading_20_3" style:display-name="Heading 3" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="3"><style:paragraph-properties fo:margin-top="0.4cm" fo:margin-bottom="0.15cm"/><style:text-properties fo:font-size="12.5pt" fo:text-transform="uppercase" fo:letter-spacing="0.04cm"/></style:style>
<style:style style:name="Code" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-bottom="0cm" fo:background-color="#f3f1ec" fo:padding-left="0.2cm"/><style:text-properties style:font-name="Courier New" fo:font-size="9.5pt"/></style:style>
<style:style style:name="Rule" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:border-bottom="1.2pt solid #1a1a1a" fo:margin-bottom="0.3cm"/></style:style>
<style:style style:name="Figure" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center"/></style:style>
<style:style style:name="TableBody" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-bottom="0cm"/><style:text-properties fo:font-size="10.5pt"/></style:style>
<style:style style:name="TableHead" style:family="paragraph" style:parent-style-name="TableBody"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="Footer" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="end"/><style:text-properties fo:font-size="8.5pt" fo:font-style="italic" fo:color="#6e6b63"/></style:style>
<text:list-style style:name="LBullet">${Array.from({ length: 6 }, (_, i) => `<text:list-level-style-bullet text:level="${i + 1}" text:bullet-char="${['•', '◦', '▪'][i % 3]}"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.5cm" fo:margin-left="${(i + 1) * 0.9}cm"/></style:list-level-properties></text:list-level-style-bullet>`).join('')}</text:list-style>
<text:list-style style:name="LTask">${Array.from({ length: 6 }, (_, i) => `<text:list-level-style-bullet text:level="${i + 1}" text:bullet-char=" "><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="nothing" fo:text-indent="0cm" fo:margin-left="${(i + 1) * 0.5}cm"/></style:list-level-properties></text:list-level-style-bullet>`).join('')}</text:list-style>
<text:list-style style:name="LNumber">${Array.from({ length: 6 }, (_, i) => `<text:list-level-style-number text:level="${i + 1}" style:num-suffix="." style:num-format="${['1', 'a', 'i'][i % 3]}"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.6cm" fo:margin-left="${(i + 1) * 0.9}cm"/></style:list-level-properties></text:list-level-style-number>`).join('')}</text:list-style>
</office:styles>
<office:automatic-styles><style:page-layout style:name="A4"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-top="2.3cm" fo:margin-bottom="1.6cm" fo:margin-left="2.3cm" fo:margin-right="2.3cm"/><style:footer-style><style:header-footer-properties fo:min-height="0.6cm" fo:margin-top="0.4cm"/></style:footer-style></style:page-layout></office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="A4"><style:footer><text:p text:style-name="Footer"><text:page-number text:select-page="current">1</text:page-number></text:p></style:footer></style:master-page></office:master-styles>
</office:document-styles>`;

export async function toOdt(blocks: Block[], title: string, images: OdtImages = {}): Promise<Blob> {
  const w = new Writer();
  const body = w.blocks(blocks, images);
  const auto =
    [...w.autoStyles].map(([props, name]) => `<style:style style:name="${name}" style:family="text"><style:text-properties ${props}/></style:style>`).join('') +
    '<style:style style:name="Tbl" style:family="table"><style:table-properties style:width="16.4cm" table:align="margins" fo:margin-bottom="0.3cm"/></style:style>' +
    '<style:style style:name="Cell" style:family="table-cell"><style:table-cell-properties fo:padding="0.1cm" fo:border="0.6pt solid #1a1a1a"/></style:style>' +
    '<style:style style:name="CellHead" style:family="table-cell"><style:table-cell-properties fo:padding="0.1cm" fo:border="0.6pt solid #1a1a1a" fo:background-color="#f3f1ec"/></style:style>';
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS}>${FONTS}<office:automatic-styles>${auto}</office:automatic-styles><office:body><office:text>${body || '<text:p text:style-name="Body"/>'}</office:text></office:body></office:document-content>`;
  const meta = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta ${NS}><office:meta><dc:title>${x(title)}</dc:title><meta:generator>Scrabbler</meta:generator><dc:date>${new Date().toISOString()}</dc:date></office:meta></office:document-meta>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
<manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
${w.pics.map((p) => `<manifest:file-entry manifest:full-path="${p.path}" manifest:media-type="${p.mime}"/>`).join('\n')}
</manifest:manifest>`;
  const zip = new JSZip();
  // The mimetype entry must come first and be stored uncompressed.
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  zip.file('content.xml', content);
  zip.file('styles.xml', STYLES);
  zip.file('meta.xml', meta);
  zip.file('META-INF/manifest.xml', manifest);
  for (const p of w.pics) zip.file(p.path, p.bytes);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.oasis.opendocument.text', compression: 'DEFLATE' });
}
