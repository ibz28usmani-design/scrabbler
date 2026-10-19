import { useSettings } from '../lib/settings';
import { FEATURES, lastUsedText, setHidden, staleFeatures, useUsage } from '../lib/usage';

/**
 * What the app shows. Each feature says when it was last used on this device;
 * one unused for a month is marked, and anything can be hidden from the
 * sidebar or Studio (nothing is deleted, and it can be shown again here).
 */
export function FeatureSettings() {
  const usage = useUsage();
  const { hiddenFeatures } = useSettings();
  const stale = new Set(staleFeatures(usage));
  const groups: { title: string; where: 'sidebar' | 'studio' | 'other' }[] = [
    { title: 'Sidebar', where: 'sidebar' },
    { title: 'Studio', where: 'studio' },
    { title: 'Also counted', where: 'other' },
  ];
  const suggest = [...stale].filter((f) => !hiddenFeatures.includes(f));
  return (
    <section className="set-section">
      <h3>Sidebar &amp; features</h3>
      <p className="muted">
        Counted on this device only. {suggest.length ? `${suggest.length} feature${suggest.length === 1 ? ' hasn’t' : 's haven’t'} been used in a month — hiding ${suggest.length === 1 ? 'it' : 'them'} keeps the sidebar to what you use.` : 'Untick anything you don’t use to take it out of the sidebar or Studio.'}
      </p>
      {suggest.length > 0 && (
        <button className="btn small" onClick={() => suggest.forEach((f) => setHidden(f, true))}>
          Hide the {suggest.length} unused
        </button>
      )}
      {groups.map((g) => (
        <div key={g.where} className="feature-group">
          <h4>{g.title}</h4>
          <ul className="feature-list">
            {FEATURES.filter((f) => f.where === g.where).map((f) => (
              <li key={f.id}>
                <label className="check-row">
                  {f.hideable ? <input type="checkbox" checked={!hiddenFeatures.includes(f.id)} onChange={(e) => setHidden(f.id, !e.target.checked)} /> : <span className="feature-fixed" aria-hidden="true" />}
                  <span className="feature-name">{f.label}</span>
                </label>
                <span className={`feature-use muted small ${stale.has(f.id) ? 'stale' : ''}`}>{lastUsedText(usage.uses[f.id])}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
