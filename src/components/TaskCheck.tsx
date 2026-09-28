"use client";

import { useOptimistic, useTransition } from "react";
import { toggleTask } from "@/lib/actions";
import { Icon } from "./ui";

export function TaskCheck({ id, done, size = 16 }: { id: string; done: boolean; size?: number }) {
  const [optimistic, setOptimistic] = useOptimistic(done);
  const [, start] = useTransition();
  return (
    <button
      role="checkbox"
      aria-checked={optimistic}
      className="check"
      title={optimistic ? "Riapri" : "Completa"}
      style={{ width: size, height: size, marginTop: 2 }}
      onClick={() => start(async () => { setOptimistic(!optimistic); await toggleTask(id); })}
    >
      {optimistic && <Icon name="check" size={size - 4} />}
    </button>
  );
}
