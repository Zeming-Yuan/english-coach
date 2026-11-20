import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

export function useAiConfig() {
  const [state, setState] = useState({ config: null, error: null });
  const [readVersion, setReadVersion] = useState(0);

  useEffect(() => {
    const request = new AbortController();
    api("/api/ai-config", { signal: request.signal })
      .then(config => {
        if (typeof config?.has_key !== "boolean") throw new Error("配置响应不完整");
        if (!request.signal.aborted) setState({ config, error: null });
      })
      .catch(error => {
        if (!request.signal.aborted) setState({ config: null, error: error.message });
      });
    return () => request.abort();
  }, [readVersion]);

  const reload = () => {
    setState({ config: null, error: null });
    setReadVersion(version => version + 1);
  };

  return { ...state, reload, setConfig: config => setState({ config, error: null }) };
}
