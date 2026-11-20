import React, {useEffect, useState} from "react";
import {api} from "../lib/api.js";
import {selectedExpansionOperations, watchExpansionAdditions} from "../lib/expansionAdditions.js";

async function additionsForRound(id, options) {
  const operations = selectedExpansionOperations(id);
  if (!operations.length) return [];
  const settings = await api("/api/expansion-additions", options);
  if (settings.practice_enabled === false) return [];
  return (await Promise.all(operations.map(operation =>
    api(`/api/expansion-additions/${operation}`, options).catch(error => {
      if (error.status === 404) return null;
      throw error;
    })))).filter(Boolean);
}

export default function ExpansionPracticeLinks({studySessionId, cardId, onStart}) {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!studySessionId) return;
    return watchExpansionAdditions(() => setReload(value => value + 1));
  }, [studySessionId]);
  useEffect(() => {
    if (!onStart || (!studySessionId && !cardId)) return;
    const controller = new AbortController();
    const options = {signal: controller.signal};
    setEntries([]);
    setError("");
    async function load() {
      let additions;
      if (studySessionId) {
        additions = await additionsForRound(studySessionId, options);
      } else {
        const listed = await api(`/api/expansion-additions?target_card_id=${cardId}`, options);
        additions = listed.practice_enabled === false ? [] : listed.additions;
      }
      const live = (additions || []).filter(row => row.available && row.source_card_id);
      if (!live.length) return [];
      const {cards} = await api("/api/cards", options);
      const byId = new Map(cards.map(card => [card.id, card]));
      const seen = new Set();
      return live.flatMap(addition => {
        const source = byId.get(addition.source_card_id);
        const target = byId.get(addition.target_card_id);
        if (!source?.content_revision || !target?.content_revision) return [];
        const key = `${source.id}:${target.id}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{addition, source, target}];
      });
    }
    load().then(value => { if (!controller.signal.aborted) setEntries(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [studySessionId, cardId, Boolean(onStart), reload]);

  if (!entries.length && !error) return null;
  return <div className="expansion-practice-links">
    {error && <div role="alert">{error}
      <button type="button" className="btn btn-ghost btn-small" onClick={() => setReload(value => value + 1)}>
        重试查找已加入词
      </button>
    </div>}
    {entries.map(entry => <button type="button" className="btn btn-ghost btn-small"
      key={entry.addition.operation_id} onClick={() => onStart(entry)}>
      {studySessionId ? `练习 ${entry.target.word.trim()}` : "练这个扩展词"}
      {entries.filter(other => other.target.id === entry.target.id).length > 1 && `（来自 ${entry.source.word.trim()}）`}
    </button>)}
  </div>;
}
