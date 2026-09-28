import { Icon } from "@/components/ui";

export default function PeopleIndex() {
  return (
    <div className="people-empty" style={{ padding: "40px 48px 72px", maxWidth: 980 }}>
      <div className="empty">
        <span className="faint"><Icon name="users" size={20} /></span>
        <div className="empty-title">Seleziona una persona</div>
        <p className="muted" style={{ margin: 0, fontSize: 14, maxWidth: 420 }}>Le persone menzionate nelle catture confermate compaiono qui, con elementi, progetti e interazioni.</p>
      </div>
    </div>
  );
}
