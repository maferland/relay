import { useMemo, useState } from "react";
import { Avatar, Icon } from "../components/ui.tsx";
import { lastNote, STATE_META, transitionMeta } from "../lib/transitions.ts";
import type { Actor, State, Transition, UiTask } from "../lib/types.ts";

const FLOW_COLS: State[] = ["todo", "doing", "review", "done"];

interface KanbanProps {
  tasks: UiTask[];
  actors: Record<string, Actor>;
  me: string;
  onOpen: (id: string) => void;
  onAction: (task: UiTask, t: Transition) => void;
}

function KanbanCard({
  task,
  actors,
  me,
  onOpen,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  task: UiTask;
  actors: Record<string, Actor>;
  me: string;
  onOpen: (id: string) => void;
  onDragStart: (e: React.DragEvent, task: UiTask) => void;
  onDragEnd: () => void;
  dragging: boolean;
}) {
  const note = task.state === "blocked" ? lastNote(task) : null;
  const needsMe = task.needsHuman || task.state === "blocked" || (task.state === "review" && task.assignee === me);
  return (
    <div
      className={`kcard ${task.state === "blocked" ? "is-blocked" : ""} ${dragging ? "is-dragging" : ""}`}
      draggable
      onDragStart={(e) => onDragStart(e, task)}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(task.id)}
    >
      <div className="kcard-top">
        <span className="kcard-id mono">{task.id}</span>
        <span className="meta mono">
          <Icon name="folder" size={11} /> {task.project}
        </span>
        {needsMe && <span className="kcard-att" title="needs you" />}
      </div>
      <div className="kcard-title">{task.title}</div>
      {note && <div className="kcard-reason">{note.note}</div>}
      <div className="kcard-foot">
        {task.branch ? (
          <span className="meta mono">
            <Icon name="branch" size={11} /> {task.branch.replace(/^(feat|fix|chore|docs|refactor)\//, "")}
          </span>
        ) : (
          <span className="meta">unclaimed</span>
        )}
        <span className="kcard-grip">
          <Icon name="list" size={13} />
        </span>
        {task.assignee ? <Avatar actorId={task.assignee} actors={actors} size={20} /> : <span className="kdash" />}
      </div>
    </div>
  );
}

export function Kanban({ tasks, actors, me, onOpen, onAction }: KanbanProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<State | null>(null);

  const byState = useMemo(() => {
    const m: Record<string, UiTask[]> = { todo: [], doing: [], review: [], done: [], blocked: [] };
    for (const t of tasks) (m[t.state] || (m[t.state] = [])).push(t);
    for (const k in m) m[k].sort((a, b) => b.updatedAt - a.updatedAt);
    return m;
  }, [tasks]);

  const onDragStart = (e: React.DragEvent, task: UiTask) => {
    setDragId(task.id);
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", task.id);
    } catch {
      // some browsers restrict setData; dragId covers it
    }
  };
  const onDragEnd = () => {
    setDragId(null);
    setOverCol(null);
  };

  const handleDrop = (e: React.DragEvent, state: State) => {
    e.preventDefault();
    const id = dragId || (e.dataTransfer && e.dataTransfer.getData("text/plain"));
    setOverCol(null);
    setDragId(null);
    const task = tasks.find((x) => x.id === id);
    if (!task || task.state === state) return;
    onAction(task, transitionMeta(task.state, state));
  };

  const dragTask = tasks.find((x) => x.id === dragId);

  const Col = (state: State, lane = false) => {
    const list = byState[state] || [];
    const valid = !!dragTask && dragTask.state !== state;
    const back = dragTask ? transitionMeta(dragTask.state, state) : null;
    return (
      <div
        key={state}
        className={`kcol kcol-${state} ${lane ? "kcol-lane" : ""} ${overCol === state && valid ? "is-over" : ""} ${
          overCol === state && back?.requiresNote ? "needs-note" : ""
        }`}
        onDragOver={(e) => {
          if (valid) {
            e.preventDefault();
            setOverCol(state);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setOverCol(state === overCol ? null : overCol);
        }}
        onDrop={(e) => handleDrop(e, state)}
      >
        <div className="kcol-head">
          <span className="badge-dot" style={{ background: `var(--st-${state}-fg)` }} />
          <span className="kcol-name">{STATE_META[state].label}</span>
          <span className="kcol-count mono">{list.length}</span>
        </div>
        <div className="kcol-body">
          {list.map((t) => (
            <KanbanCard
              key={t.id}
              task={t}
              actors={actors}
              me={me}
              onOpen={onOpen}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              dragging={dragId === t.id}
            />
          ))}
          {valid && back && (
            <div className="kdrop">
              <Icon name={back.icon} size={14} />
              {back.requiresNote ? "Drop — needs a note" : "Drop to " + STATE_META[state].label.toLowerCase()}
            </div>
          )}
          {!list.length && !valid && <div className="kempty">—</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="kanban">
      {FLOW_COLS.map((s) => Col(s))}
      {Col("blocked", true)}
    </div>
  );
}
