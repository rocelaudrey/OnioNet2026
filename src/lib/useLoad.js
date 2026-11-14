import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

// Loads one API path. Returns { data, error, loading, reload, setData }.
export function useLoad(path) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const reload = useCallback(() => {
    api(path)
      .then((data) => setState({ data, error: '', loading: false }))
      .catch((err) => setState({ data: null, error: err.message, loading: false }));
  }, [path]);
  useEffect(reload, [reload]);
  const setData = useCallback((data) => setState({ data, error: '', loading: false }), []);
  return { ...state, reload, setData };
}

// Runs a save action and tracks busy / error / saved for a form.
export function useSave() {
  const [state, setState] = useState({ busy: false, error: '', saved: false });
  const run = useCallback(async (action) => {
    setState({ busy: true, error: '', saved: false });
    try {
      const result = await action();
      setState({ busy: false, error: '', saved: true });
      return result;
    } catch (err) {
      setState({ busy: false, error: err.message, saved: false });
      return undefined;
    }
  }, []);
  return { ...state, run };
}
