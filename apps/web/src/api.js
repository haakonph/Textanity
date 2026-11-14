export const versions = {
  approved: 'Godkjent',
  development: 'Utkast fra utvikling',
  subject: 'Utkast fra fag',
  translation: 'Utkast fra oversettelse',
};
export const languageName = (locale) => {
  const known = { nb: 'Bokmål', nn: 'Nynorsk', 'en-GB': 'Engelsk' };
  if (Object.hasOwn(known, locale)) return known[locale];
  try {
    return new Intl.DisplayNames(['nb'], { type: 'language' }).of(locale);
  } catch {
    return locale;
  }
};
export async function api(token, path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(`/api/editor${path}`, {
    method,
    signal,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Kan ikke koble til redaktør-API-et. Prøv igjen.');
  }
  if (!response.ok) {
    const messages = {
      401: 'Redaktørnøkkelen er feil eller utløpt.',
      503: 'Redaktørtilgang er ikke satt opp på serveren.',
      409: 'Innholdet er endret eller finnes allerede. Last inn på nytt og kontroller endringene.',
      400:
        data.error === 'Invalid ICU message or inconsistent translation parameters'
          ? 'Kontroller meldingsformatet og at oversettelsene bruker de samme variablene.'
          : 'Kontroller feltene og språkkoden.',
      404: 'Innholdet finnes ikke i dette arbeidsområdet.',
    };
    const error = new Error(messages[response.status] || 'Kan ikke utføre handlingen. Prøv igjen.');
    error.status = response.status;
    throw error;
  }
  return data;
}
