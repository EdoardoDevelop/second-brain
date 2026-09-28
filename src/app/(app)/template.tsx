/**
 * Si rimonta a ogni cambio di pagina: ne anima l'entrata (stile Android, "fade through").
 * Occupa tutta l'altezza, così le pagine a tutto schermo (Assistente, Connessioni) restano identiche.
 */
export default function PageTransition({ children }: { children: React.ReactNode }) {
  return <div className="page-anim">{children}</div>;
}
