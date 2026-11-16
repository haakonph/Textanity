import { useEffect, useState } from 'react';
import { api } from './api.js';
import FormDialog from './FormDialog.jsx';
import TextTable from './TextTable.jsx';

const keyField = { label: 'Nøkkel', name: 'key', pattern: '[a-z][a-z0-9_]*', maxLength: 160 };
const nameField = { label: 'Navn', name: 'name' };
const slugField = { label: 'Identifikator', name: 'slug', pattern: '[a-z0-9]+(-[a-z0-9]+)*', maxLength: 160 };
const titleField = { label: 'Intern tittel', name: 'title' };
const pathField = { label: 'Sti', name: 'path', value: '/', maxLength: 2048 };
const statusField = {
  label: 'Status',
  name: 'status',
  value: 'draft',
  options: [
    { value: 'draft', label: 'Utkast' },
    { value: 'published', label: 'Publisert' },
  ],
};
function PropertyTable({ entries }) {
  return (
    <div className="table-scroll">
      <table className="properties">
        <thead>
          <tr>
            <th>Egenskap</th>
            <th>Verdi</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <th scope="row">{key}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState('');
  const [catalog, setCatalog] = useState({ apps: [], groups: [] });
  const [context, setContext] = useState(null);
  const [nav, setNav] = useState({ screen: 'home', app: null, pageId: null, viewId: null });
  const [version, setVersion] = useState('approved');
  const [dirty, setDirty] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [tableRefresh, setTableRefresh] = useState(0);
  const app = context?.app.slug === nav.app ? context.app : null;
  const pages = app ? context.pages : [];
  const views = app ? context.views : [];
  const placements = app ? context.placements : [];
  const page = pages.find((row) => row.id === nav.pageId);
  const view = views.find((row) => row.id === nav.viewId);
  async function refreshCatalog() {
    setCatalog(await api(token, '/catalog'));
  }
  function navigate(next) {
    if (dirty && !window.confirm('Forkaste de ulagrede tekstendringene?')) return;
    setDirty(false);
    setError('');
    setNav((old) => ({ ...old, ...next, placementId: next.placementId || null }));
  }
  useEffect(() => {
    if (!token || !nav.app) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api(token, `/apps/${nav.app}`, { signal: controller.signal })
      .then((data) => {
        setContext(data);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [token, nav.app, refresh]);
  useEffect(() => {
    function beforeUnload(event) {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  function form(title, fields, run) {
    setDialog({ title, fields, onSubmit: run });
  }
  const updateStructure = () => setRefresh((old) => old + 1);
  const updateTexts = () => setTableRefresh((old) => old + 1);
  function createGroup() {
    form('Ny tekstgruppe', [nameField, keyField], async (values) => {
      await api(token, '/groups', { method: 'POST', body: values });
      await refreshCatalog();
      updateTexts();
    });
  }
  function createKey() {
    const groups = catalog.groups;
    if (!groups.length) return createGroup();
    form(
      'Ny tekst',
      [
        {
          label: 'Tekstgruppe',
          name: 'group',
          options: groups.map((g) => ({ value: g.key, label: `${g.name} (${g.key})` })),
        },
        keyField,
      ],
      async (values) => {
        await api(token, '/keys', { method: 'POST', body: values });
        updateTexts();
      },
    );
  }
  function linkGroup() {
    if (!catalog.groups.length) return createGroup();
    form(
      'Koble tekstgruppe',
      [
        {
          label: 'Tekstgruppe',
          name: 'groupId',
          options: catalog.groups.map((g) => ({ value: g.id, label: `${g.name} (${g.key})` })),
        },
      ],
      async (body) => {
        await api(token, `/apps/${nav.app}/groups`, { method: 'POST', body });
        updateTexts();
      },
    );
  }
  async function attachKey() {
    try {
      const all = await api(token, `/texts?app=${nav.app}&status=approved`);
      if (!all.rows.length) return linkGroup();
      form(
        'Koble tekst til visningen',
        [
          {
            label: 'Tekst',
            name: 'textId',
            options: all.rows.map((row) => ({ value: row.id, label: row.fullKey })),
          },
        ],
        async ({ textId }) => {
          const textIds = [
            ...new Set([
              ...all.rows.filter((row) => view.text_keys.includes(row.fullKey)).map((row) => row.id),
              textId,
            ]),
          ];
          await api(token, `/apps/${nav.app}/views/${view.id}/texts`, { method: 'PUT', body: { textIds } });
          updateStructure();
          updateTexts();
        },
      );
    } catch (err) {
      setError(err.message);
    }
  }
  if (!token)
    return (
      <main className="login">
        <p className="eyebrow">TEXTANITY</p>
        <h1>Innhold på ett sted.</h1>
        <p>Åpne redaktørverktøyet med redaktørnøkkelen din.</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const value = event.currentTarget.elements.token.value;
            setLoading(true);
            setError('');
            try {
              const catalog = await api(value, '/catalog');
              setCatalog(catalog);
              setToken(value);
            } catch (err) {
              setError(err.message);
            } finally {
              setLoading(false);
            }
          }}
        >
          <label>
            Redaktørnøkkel
            <input name="token" type="password" autoComplete="off" required minLength={32} />
          </label>
          <button className="primary" disabled={loading}>
            {loading ? 'Åpner …' : 'Åpne Textanity'}
          </button>
        </form>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </main>
    );

  const pagePlacements = placements.filter((p) => p.page_id === nav.pageId);
  const usage = (id) => [
    ...new Set(
      placements
        .filter((p) => p.view_id === id)
        .map((p) => pages.find((page) => page.id === p.page_id)?.title)
        .filter(Boolean),
    ),
  ];
  const appNav = ['pages', 'page', 'views', 'view', 'texts'].includes(nav.screen);
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="logo" onClick={() => navigate({ screen: 'home' })}>
          Textanity<span>.</span>
        </button>
        <button
          onClick={() => {
            if (!dirty || window.confirm('Forkaste ulagrede endringer og logge ut?')) {
              setToken('');
              setContext(null);
              setDirty(false);
              setNav({ screen: 'home', app: null });
            }
          }}
        >
          Logg ut
        </button>
      </header>
      <div className="layout">
        <aside className="sidebar">
          <p className="eyebrow">ARBEIDSOMRÅDER</p>
          <button
            aria-current={nav.screen === 'home' ? 'page' : undefined}
            onClick={() => navigate({ screen: 'home' })}
          >
            Apper
          </button>
          <button
            aria-current={nav.screen === 'common' ? 'page' : undefined}
            onClick={() => navigate({ screen: 'common' })}
          >
            Felles område
          </button>
          {appNav && (
            <>
              <label>
                VALGT APP
                <select
                  aria-label="Valgt app"
                  value={nav.app || ''}
                  onChange={(event) =>
                    navigate({ screen: 'pages', app: event.target.value, pageId: null, viewId: null })
                  }
                >
                  {catalog.apps.map((app) => (
                    <option key={app.id} value={app.slug}>
                      {app.name}
                    </option>
                  ))}
                </select>
              </label>
              {[
                ['pages', 'Sider'],
                ['views', 'Visninger'],
                ['texts', 'Appens tekster'],
              ].map(([screen, label]) => (
                <button
                  key={screen}
                  aria-current={
                    nav.screen === screen ||
                    (screen === 'pages' &&
                      (nav.screen === 'page' || (nav.screen === 'view' && nav.pageId))) ||
                    (screen === 'views' && nav.screen === 'view' && !nav.pageId)
                      ? 'page'
                      : undefined
                  }
                  onClick={() => navigate({ screen, pageId: null, viewId: null })}
                >
                  {label}
                </button>
              ))}
            </>
          )}
        </aside>
        <main className="workspace">
          <nav className="breadcrumbs" aria-label="Brødsmulesti">
            <button onClick={() => navigate({ screen: 'home' })}>Arbeidsområder</button>
            {nav.screen === 'common' ? (
              <span>/ Felles område</span>
            ) : (
              app &&
              nav.screen !== 'home' && (
                <>
                  <span>/</span>
                  <button onClick={() => navigate({ screen: 'pages', pageId: null, viewId: null })}>
                    {app.name}
                  </button>
                  {page && (
                    <>
                      <span>/</span>
                      <button onClick={() => navigate({ screen: 'page', viewId: null })}>{page.title}</button>
                    </>
                  )}
                  {view && <span>/ {view.name}</span>}
                </>
              )
            )}
          </nav>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {nav.screen === 'home' && (
            <>
              <div className="heading">
                <div>
                  <p className="eyebrow">ARBEIDSOMRÅDER</p>
                  <h1>Hvor vil du jobbe?</h1>
                  <p className="muted">Velg en app eller gå til felles innhold.</p>
                </div>
                <button
                  onClick={() =>
                    form(
                      'Ny app',
                      [
                        nameField,
                        slugField,
                        { label: 'Standardspråk', name: 'defaultLocale', value: 'nb', maxLength: 63 },
                      ],
                      async (body) => {
                        await api(token, '/apps', { method: 'POST', body });
                        await refreshCatalog();
                      },
                    )
                  }
                >
                  Ny app
                </button>
              </div>
              <h2>Apper</h2>
              <div className="app-grid">
                {catalog.apps.map((app) => (
                  <button
                    className="app-card"
                    key={app.id}
                    onClick={() => navigate({ screen: 'pages', app: app.slug, pageId: null, viewId: null })}
                  >
                    <strong>{app.name}</strong>
                    <span>Sider, visninger og tekster</span>
                    <small>{app.slug}</small>
                  </button>
                ))}
              </div>
              <h2>På tvers av apper</h2>
              <button className="common-card" onClick={() => navigate({ screen: 'common' })}>
                <strong>Felles område</strong>
                <span>Tekstgrupper og oversettelser som flere apper bruker</span>
              </button>
            </>
          )}
          {appNav && (loading || !app) ? (
            <p role="status">Laster app …</p>
          ) : (
            <>
              {nav.screen === 'pages' && (
                <>
                  <div className="heading">
                    <h1>Sider</h1>
                    <button
                      onClick={() =>
                        form('Ny side', [titleField, pathField, statusField], async (body) => {
                          await api(token, `/apps/${nav.app}/pages`, { method: 'POST', body });
                          updateStructure();
                        })
                      }
                    >
                      Ny side
                    </button>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Side</th>
                          <th>Sti</th>
                          <th>Status</th>
                          <th>Visninger</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pages.map((page) => (
                          <tr key={page.id}>
                            <th scope="row">
                              <button
                                className="text-link"
                                onClick={() => navigate({ screen: 'page', pageId: page.id, viewId: null })}
                              >
                                {page.title}
                              </button>
                            </th>
                            <td>{page.path}</td>
                            <td>{page.status === 'draft' ? 'Utkast' : 'Publisert'}</td>
                            <td>{page.view_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!pages.length && <p>Ingen sider ennå. Opprett den første siden.</p>}
                </>
              )}
              {nav.screen === 'page' && page && (
                <>
                  <div className="heading">
                    <h1>{page.title}</h1>
                    <button
                      disabled={!views.length}
                      onClick={() =>
                        form(
                          'Legg til visning',
                          [
                            {
                              label: 'Visning',
                              name: 'viewId',
                              options: views.map((view) => ({ value: view.id, label: view.name })),
                            },
                          ],
                          async (body) => {
                            await api(token, `/apps/${nav.app}/pages/${page.id}/views`, {
                              method: 'POST',
                              body,
                            });
                            updateStructure();
                          },
                        )
                      }
                    >
                      Legg til visning
                    </button>
                  </div>
                  <h2>Visninger på siden</h2>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Rekkefølge</th>
                          <th>Visning</th>
                          <th>Type</th>
                          <th>Gjenbruk</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagePlacements.map((placement) => {
                          const view = views.find((v) => v.id === placement.view_id);
                          return (
                            <tr key={placement.id}>
                              <td>{placement.position + 1}</td>
                              <th scope="row">
                                <button
                                  className="text-link"
                                  onClick={() =>
                                    navigate({ screen: 'view', viewId: view.id, placementId: placement.id })
                                  }
                                >
                                  {view.name}
                                </button>
                              </th>
                              <td>{view.type}</td>
                              <td>{usage(view.id).length} sider</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {!pagePlacements.length && (
                    <p className="muted">
                      Ingen visninger på siden. Opprett en visning under «Visninger» og legg den til her.
                    </p>
                  )}
                  <div className="heading">
                    <h2>Sideinformasjon</h2>
                    <button
                      onClick={() =>
                        form(
                          'Rediger side',
                          [
                            { ...titleField, value: page.title },
                            { ...pathField, value: page.path },
                            { ...statusField, value: page.status },
                          ],
                          async (body) => {
                            await api(token, `/apps/${nav.app}/pages/${page.id}`, { method: 'PUT', body });
                            updateStructure();
                          },
                        )
                      }
                    >
                      Rediger side
                    </button>
                  </div>
                  <PropertyTable
                    entries={[
                      ['App', app.name],
                      ['Intern tittel', page.title],
                      ['Sti', page.path],
                      ['Status', page.status === 'draft' ? 'Utkast' : 'Publisert'],
                    ]}
                  />
                </>
              )}
              {nav.screen === 'views' && (
                <>
                  <div className="heading">
                    <h1>Visninger</h1>
                    <button
                      onClick={() =>
                        form(
                          'Ny visning',
                          [
                            nameField,
                            {
                              label: 'Komponenttype',
                              name: 'type',
                              pattern: '[a-z][a-z0-9_-]*',
                              value: 'hero',
                              maxLength: 80,
                            },
                          ],
                          async (body) => {
                            await api(token, `/apps/${nav.app}/views`, { method: 'POST', body });
                            updateStructure();
                          },
                        )
                      }
                    >
                      Ny visning
                    </button>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Visning</th>
                          <th>Type</th>
                          <th>Brukes på</th>
                          <th>Tekster</th>
                        </tr>
                      </thead>
                      <tbody>
                        {views.map((view) => (
                          <tr key={view.id}>
                            <th scope="row">
                              <button
                                className="text-link"
                                onClick={() => navigate({ screen: 'view', viewId: view.id, pageId: null })}
                              >
                                {view.name}
                              </button>
                            </th>
                            <td>{view.type}</td>
                            <td>{usage(view.id).join(', ') || 'Ingen sider'}</td>
                            <td>{view.text_keys.length}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!views.length && <p>Ingen visninger ennå.</p>}
                </>
              )}
              {nav.screen === 'view' && view && (
                <>
                  <div className="heading">
                    <div>
                      <p className="eyebrow">{page ? 'VISNING PÅ SIDEN' : 'GJENBRUKBAR VISNING'}</p>
                      <h1>{view.name}</h1>
                    </div>
                  </div>
                  <TextTable
                    key={`${nav.app}/${view.id}/${nav.pageId}/${nav.placementId}/${tableRefresh}`}
                    token={token}
                    app={nav.app}
                    view={view.id}
                    page={nav.pageId || undefined}
                    placement={nav.placementId || undefined}
                    version={version}
                    onVersion={setVersion}
                    onDirty={setDirty}
                    onAttachKey={attachKey}
                  />
                  <details className="view-settings">
                    <summary>Visningsinformasjon</summary>
                    <PropertyTable
                      entries={[
                        ['Type', view.type],
                        ['Brukes på', usage(view.id).join(', ') || 'Ingen sider'],
                      ]}
                    />
                  </details>
                </>
              )}
              {nav.screen === 'texts' && (
                <>
                  <h1>Appens tekster</h1>
                  <p className="muted">
                    Egne utkast og overstyringer gjelder {app.name}. Uendrede celler henter appens godkjente
                    tekst.
                  </p>
                  <TextTable
                    key={`${nav.app}/${tableRefresh}`}
                    token={token}
                    app={nav.app}
                    version={version}
                    onVersion={setVersion}
                    onDirty={setDirty}
                    onLinkGroup={linkGroup}
                  />
                </>
              )}
            </>
          )}
          {nav.screen === 'common' && (
            <>
              <div className="heading">
                <h1>Felles tekster</h1>
                <button disabled={dirty} onClick={createGroup}>
                  Ny tekstgruppe
                </button>
              </div>
              <p className="muted">
                Godkjente felles tekster brukes av tilknyttede apper. Appenes egne overstyringer beholdes.
              </p>
              <TextTable
                key={`common/${tableRefresh}`}
                token={token}
                version={version}
                onVersion={setVersion}
                onDirty={setDirty}
                onCreateKey={createKey}
              />
            </>
          )}
        </main>
      </div>
      {dialog && <FormDialog {...dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}
