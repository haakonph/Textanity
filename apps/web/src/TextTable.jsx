import { useEffect, useState } from 'react';
import { api, languageName, versions } from './api.js';

export default function TextTable({
  token,
  app,
  view,
  page,
  placement,
  version,
  onVersion,
  onDirty,
  onCreateKey,
  onLinkGroup,
  onAttachKey,
}) {
  const [data, setData] = useState(null);
  const [dirty, setDirty] = useState({});
  const [extraLocales, setExtraLocales] = useState(['nb', 'nn', 'en-GB']);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState(null);
  const query = new URLSearchParams({
    status: version,
    locales: extraLocales.join(','),
    ...(app ? { app } : {}),
    ...(view ? { view } : {}),
    ...(page ? { page } : {}),
    ...(placement ? { placement } : {}),
  });
  const queryString = query.toString();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setError(null);
    setHistory(null);
    api(token, `/texts?${queryString}`, { signal: controller.signal })
      .then((value) => {
        setData(value);
        setDirty({});
        setLoading(false);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(err);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [token, queryString, reload]);
  useEffect(() => {
    onDirty(Object.keys(dirty).length > 0);
  }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  const unsaved = Object.keys(dirty).length > 0;
  const confirmDiscard = () => !unsaved || window.confirm('Forkaste de ulagrede tekstendringene?');
  const id = (row, locale) => `${row.id}/${locale}`;
  function operation(row, locale, message) {
    const cell = row.cells[locale];
    return {
      textId: row.id,
      locale,
      message,
      revision: cell.revision,
      approvedRevision: cell.approvedRevision,
    };
  }
  function edit(row, locale, message) {
    setDirty((previous) => {
      const next = { ...previous };
      if (message === row.cells[locale].message && message !== null) delete next[id(row, locale)];
      else next[id(row, locale)] = operation(row, locale, message);
      return next;
    });
    setNotice('');
  }
  const cells =
    data?.rows.flatMap((row) => data.locales.map((locale) => ({ row, locale, cell: row.cells[locale] }))) ||
    [];
  const pending = cells.filter(({ cell }) => cell.revision && cell.sourceStatus !== 'approved');
  const stale = cells.filter(({ cell }) => cell.stale);
  async function save(approve = false) {
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      let changes;
      if (approve)
        changes = pending.map(({ row, locale }) => {
          const { message: _message, ...change } = operation(row, locale);
          return change;
        });
      else {
        const batch = { ...dirty };
        stale.forEach(({ row, locale, cell }) => {
          if (!batch[id(row, locale)]) batch[id(row, locale)] = operation(row, locale, cell.message);
        });
        changes = Object.values(batch);
      }
      await api(token, approve ? '/texts/approve' : '/texts/batch', {
        method: 'POST',
        body: { app: app || null, status: version, changes },
      });
      setDirty({});
      setNotice(approve ? 'Endringene er godkjent.' : 'Utkastet er lagret.');
      if (approve) onVersion('approved');
      setReload((value) => value + 1);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  async function openHistory(row) {
    setError(null);
    try {
      setHistory({
        key: row.fullKey,
        rows: await api(token, `/texts/${row.id}/history${app ? `?app=${encodeURIComponent(app)}` : ''}`),
      });
    } catch (err) {
      setError(err);
    }
  }
  return (
    <>
      <div className="toolbar">
        <label>
          Vis tekstversjon
          <select
            value={version}
            disabled={busy}
            onChange={(event) => {
              if (confirmDiscard()) {
                setDirty({});
                setNotice('');
                onVersion(event.target.value);
              }
            }}
          >
            {Object.entries(versions).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">
          {version === 'approved'
            ? 'Godkjent tekst er skrivebeskyttet.'
            : 'Uendrede celler viser godkjent tekst.'}
        </span>
      </div>
      <div className="actions secondary-actions">
        {onCreateKey && (
          <button onClick={onCreateKey} disabled={busy || unsaved}>
            Ny tekst
          </button>
        )}
        {onLinkGroup && (
          <button onClick={onLinkGroup} disabled={busy || unsaved}>
            Koble tekstgruppe
          </button>
        )}
        {onAttachKey && (
          <button onClick={onAttachKey} disabled={busy || unsaved}>
            Koble tekst til visningen
          </button>
        )}
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            const field = event.currentTarget.elements.locale;
            try {
              const locale = new Intl.Locale(field.value).baseName;
              if (confirmDiscard()) {
                setExtraLocales((old) => [...new Set([...old, locale])]);
                setDirty({});
                field.value = '';
              }
            } catch {
              setError(new Error('Ugyldig språkkode. Bruk for eksempel nb eller en-GB.'));
            }
          }}
        >
          <input
            name="locale"
            aria-label="Språkkode"
            placeholder="Språkkode, f.eks. de"
            required
            maxLength={63}
          />
          <button disabled={busy || extraLocales.length >= 10}>Legg til språk</button>
        </form>
      </div>
      {error && (
        <div role="alert" className="error">
          {error.message}{' '}
          <button
            disabled={busy}
            onClick={() => {
              if (confirmDiscard()) {
                setDirty({});
                setReload((value) => value + 1);
              }
            }}
          >
            Last inn på nytt
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {loading ? (
        <p role="status">Laster tekster …</p>
      ) : (
        data && (
          <>
            {stale.length > 0 && version !== 'approved' && (
              <p className="error">
                Godkjent tekst er endret siden utkastet ble lagret. Kontroller teksten og lagre utkastet på
                nytt før godkjenning.
              </p>
            )}
            <div className="table-scroll" role="region" aria-label="Tekster og språk">
              <table className="text-table">
                <thead>
                  <tr>
                    <th scope="col">Nøkkel</th>
                    {data.locales.map((locale) => (
                      <th scope="col" key={locale}>
                        {languageName(locale)}
                        <small>{locale}</small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.id}>
                      <th scope="row">
                        <code>{row.fullKey}</code>
                        <button
                          className="text-link history-link"
                          onClick={() => openHistory(row)}
                          aria-label={`Historikk for ${row.fullKey}`}
                        >
                          Historikk
                        </button>
                      </th>
                      {data.locales.map((locale) => {
                        const cell = row.cells[locale];
                        const change = dirty[id(row, locale)];
                        const value = change
                          ? change.message === null
                            ? cell.approvedMessage
                            : change.message
                          : cell.message;
                        const isDraft = change
                          ? change.message !== null && change.message !== cell.approvedMessage
                          : cell.sourceStatus !== 'approved';
                        const sourceLocale = isDraft ? locale : cell.approvedLocale;
                        return (
                          <td key={locale} className={isDraft ? 'draft-cell' : ''}>
                            <textarea
                              rows={2}
                              aria-label={`${row.fullKey}, ${locale}`}
                              readOnly={version === 'approved' || busy}
                              value={value ?? ''}
                              placeholder="Mangler godkjent tekst"
                              maxLength={20000}
                              onChange={(event) => edit(row, locale, event.target.value)}
                            />
                            <div className="cell-source">
                              <span>
                                {isDraft
                                  ? versions[version]
                                  : value === null
                                    ? 'Ingen godkjent tekst'
                                    : 'Godkjent'}
                                {sourceLocale && sourceLocale !== locale ? ` · fra ${sourceLocale}` : ''}
                                {!isDraft && cell.approvedIsOverride ? ' · Egen apptekst' : ''}
                              </span>
                              {version !== 'approved' && (isDraft || cell.revision) && (
                                <button
                                  className="text-link"
                                  disabled={busy}
                                  onClick={() => edit(row, locale, null)}
                                >
                                  Bruk godkjent
                                </button>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.rows.length && (
              <p className="muted">
                Ingen tekster her ennå. Opprett en tekstgruppe og en nøkkel i fellesområdet, og koble gruppen
                til appen.
              </p>
            )}
            {version !== 'approved' && (
              <div className="actions">
                <button
                  className="primary"
                  disabled={busy || (!unsaved && !stale.length)}
                  onClick={() => save()}
                >
                  Lagre utkast
                </button>
                <button
                  disabled={busy || unsaved || !!stale.length || !pending.length}
                  onClick={() => save(true)}
                >
                  Godkjenn endringer
                </button>
                {unsaved && (
                  <span role="status" className="muted">
                    Ulagrede endringer
                  </span>
                )}
              </div>
            )}
          </>
        )
      )}
      {history && (
        <section className="history">
          <div className="heading">
            <h2>Historikk: {history.key}</h2>
            <button onClick={() => setHistory(null)}>Lukk historikk</button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Tidspunkt</th>
                  <th>Språk</th>
                  <th>Status</th>
                  <th>Handling</th>
                  <th>Tekst</th>
                </tr>
              </thead>
              <tbody>
                {history.rows.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.created_at).toLocaleString('nb-NO')}</td>
                    <td>{entry.locale}</td>
                    <td>
                      {versions[entry.status]}
                      {entry.source_status && <small>Fra {versions[entry.source_status]}</small>}
                    </td>
                    <td>
                      {
                        {
                          baseline: 'Utgangspunkt',
                          save: 'Lagret',
                          reset: 'Tilbakestilt',
                          approve: 'Godkjent',
                        }[entry.action]
                      }
                    </td>
                    <td className="message">
                      {entry.message === null
                        ? 'Utkast fjernet'
                        : entry.message === ''
                          ? '(tom tekst)'
                          : entry.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!history.rows.length && <p>Ingen revisjoner er lagret i dette arbeidsområdet.</p>}
          <p className="muted">De siste 100 revisjonene i dette arbeidsområdet.</p>
        </section>
      )}
    </>
  );
}
