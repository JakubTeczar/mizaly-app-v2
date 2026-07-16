interface ComingSoonPageProps {
  title: string;
  description?: string;
}

export function ComingSoonPage({ title, description }: ComingSoonPageProps) {
  return (
    <div>
      <div className="page-title-row">
        <h1 className="page-title">{title}</h1>
        <span className="badge-coming-soon">Wkrótce</span>
      </div>
      <p className="empty-state">{description ?? "Ta funkcja będzie dostępna wkrótce."}</p>
    </div>
  );
}
