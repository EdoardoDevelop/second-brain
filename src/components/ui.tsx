import type { CSSProperties, ReactNode } from "react";
import { ICONS, type IconName } from "@/lib/icons";
import type { ItemKind, ItemType } from "@/lib/db/schema";

export function Icon({ name, size = 16, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flex: "none", ...style }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

/** Cornice "blueprint" del design system, con i segni di registro agli angoli. */
export function Blueprint({ children, style, className, as: Tag = "div" }: { children: ReactNode; style?: CSSProperties; className?: string; as?: "div" | "section" }) {
  return (
    <Tag className={"blueprint" + (className ? " " + className : "")} style={style}>
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
      {children}
    </Tag>
  );
}

export const TYPE_ICON: Record<ItemType, IconName> = {
  Nota: "note", Idea: "idea", Decisione: "decision", Documento: "file", Riunione: "users", "Pagina web": "globe", Audio: "audio", Attività: "tasks",
};

export const KIND_ICON: Record<ItemKind, IconName> = { note: "note", link: "link", file: "file", audio: "audio" };

export function itemIcon(type: ItemType | null, kind: ItemKind): IconName {
  return type ? TYPE_ICON[type] : KIND_ICON[kind];
}

export function Spinner() {
  return <span className="spin" />;
}
