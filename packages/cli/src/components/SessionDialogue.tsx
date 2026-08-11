/**
 * Session history dialog body.
 *
 * Rendered inside the app dialog (opened by the `/history` command). Lists
 * every stored session newest-first and navigates to the one the user picks.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { InferResponseType } from "hono/client";
import { TextAttributes } from "@opentui/core";
import { useNavigate } from "react-router";

import { DialogSearchList } from "./DialogSearchList";
import { apiClient } from "../lib/apiClient";
import { getErrorMessage } from "../lib/httpErrors";
import { useDialog } from "../providers/dialog";
import { useToast } from "../providers/toast";

type SessionSummary = InferResponseType<
  typeof apiClient.sessions.$get,
  200
>[number];

/** Sessions are listed by title; keep rows to a single line. */
const MAX_TITLE_LENGTH = 48;

function getSessionKey(session: SessionSummary) {
  return session.id;
}

function matchesSession(session: SessionSummary, query: string) {
  return session.title.toLowerCase().includes(query.toLowerCase());
}

function renderSession(session: SessionSummary) {
  const title =
    session.title.length > MAX_TITLE_LENGTH
      ? `${session.title.slice(0, MAX_TITLE_LENGTH - 1)}…`
      : session.title;
  // `createdAt` arrives as an ISO string over the wire, not a Date.
  const day = new Date(session.createdAt).toLocaleDateString();
  return `${title}  ${day}`;
}

export function SessionDialogueContent() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const dialog = useDialog();
  const toast = useToast();

  useEffect(() => {
    let ignore = false;

    const fetchSessions = async () => {
      try {
        const response = await apiClient.sessions.$get();
        if (ignore) return;
        if (!response.ok) {
          throw new Error(await getErrorMessage(response));
        }
        const data = await response.json();
        if (ignore) return;
        setSessions(data);
      } catch (err) {
        if (ignore) return;
        setError(
          err instanceof Error ? err.message : "Failed to load sessions",
        );
      }
    };

    void fetchSessions();
    return () => {
      ignore = true;
    };
  }, []);

  const handleSelect = useCallback(
    (session: SessionSummary) => {
      dialog.close();
      // No router state: the session screen fetches the full record (with its
      // messages) itself, since the list endpoint only returns summaries.
      navigate(`/sessions/${session.id}`);
    },
    [dialog, navigate],
  );

  // Live preview has no meaning for a session list, but the list component
  // reports highlights unconditionally.
  const handleHighlight = useCallback(() => {}, []);

  const items = useMemo(() => sessions ?? [], [sessions]);

  useEffect(() => {
    if (error) {
      toast.show({ variant: "error", message: error });
    }
  }, [error, toast]);

  if (error) {
    return <text attributes={TextAttributes.DIM}>{error}</text>;
  }

  if (!sessions) {
    return <text attributes={TextAttributes.DIM}>Loading sessions…</text>;
  }

  return (
    <DialogSearchList
      items={items}
      getKey={getSessionKey}
      renderItem={renderSession}
      filterFn={matchesSession}
      onHighlight={handleHighlight}
      onSelect={handleSelect}
      placeholder="Search sessions…"
      emptyText="No sessions yet"
    />
  );
}
