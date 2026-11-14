import { useEffect, useRef, useState } from 'react';

export default function FormDialog({ title, fields, submit = 'Lagre', onSubmit, onClose }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
      aria-label={title}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const values = Object.fromEntries(new FormData(event.currentTarget));
          setBusy(true);
          setError('');
          try {
            await onSubmit(values);
            onClose();
          } catch (err) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>{title}</h2>
        <div className="table-scroll">
          <table className="properties">
            <tbody>
              {fields.map((field) => (
                <tr key={field.name}>
                  <th scope="row">
                    <label htmlFor={`field-${field.name}`}>{field.label}</label>
                  </th>
                  <td>
                    {field.options ? (
                      <select
                        id={`field-${field.name}`}
                        name={field.name}
                        defaultValue={field.value}
                        required
                        disabled={busy}
                      >
                        {field.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`field-${field.name}`}
                        name={field.name}
                        defaultValue={field.value || ''}
                        required={field.required !== false}
                        pattern={field.pattern}
                        maxLength={field.maxLength || 240}
                        type={field.type || 'text'}
                        disabled={busy}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button className="primary" disabled={busy}>
            {busy ? 'Lagrer …' : submit}
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            Avbryt
          </button>
        </div>
      </form>
    </dialog>
  );
}
